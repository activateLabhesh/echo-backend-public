// src/sockets/voiceSocket.ts
import { Server, Socket } from 'socket.io';
import { getIO } from './chatSocket';
import { userSocketMap } from './chatSocket'; // <-- IMPORTANT: Import the userSocketMap

// Error handling and recovery interfaces
interface VoiceError {
  code: string;
  message: string;
  socketId: string;
  userId?: string;
  channelId?: string;
  timestamp: Date;
  context?: any;
}

interface ConnectionState {
  socketId: string;
  userId: string;
  channelId: string;
  joinedAt: Date;
  lastActivity: Date;
  retryCount: number;
  isReconnecting: boolean;
}

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

enum VoiceErrorCode {
  AUTHENTICATION_FAILED = 'VOICE_AUTH_FAILED',
  CHANNEL_JOIN_FAILED = 'VOICE_CHANNEL_JOIN_FAILED',
  WEBRTC_SIGNALING_FAILED = 'VOICE_WEBRTC_SIGNALING_FAILED',
  STATE_UPDATE_FAILED = 'VOICE_STATE_UPDATE_FAILED',
  CONNECTION_LOST = 'VOICE_CONNECTION_LOST',
  NETWORK_ERROR = 'VOICE_NETWORK_ERROR',
  INVALID_DATA = 'VOICE_INVALID_DATA',
  CHANNEL_FULL = 'VOICE_CHANNEL_FULL',
  PERMISSION_DENIED = 'VOICE_PERMISSION_DENIED',
  RETRY_EXHAUSTED = 'VOICE_RETRY_EXHAUSTED',
  GRACEFUL_DEGRADATION = 'VOICE_GRACEFUL_DEGRADATION'
}

// Enhanced interfaces for error handling and recovery
interface RecoveryState {
  socketId: string;
  channelId: string;
  userId: string;
  voiceState: {
    muted: boolean;
    speaking: boolean;
    video: boolean;
  };
  reconnectionAttempts: number;
  lastConnectionTime: Date;
  recoveryStartTime?: Date;
}

interface NetworkQuality {
  latency: number;
  packetLoss: number;
  bandwidth: number;
  connectionType: 'excellent' | 'good' | 'poor' | 'critical';
}

interface ErrorContext {
  operation: string;
  retryable: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  networkQuality?: NetworkQuality;
}

// Error handling and recovery utility classes
class VoiceErrorHandler {
  private static errorHistory = new Map<string, VoiceError[]>();
  private static recoveryStates = new Map<string, RecoveryState>();
  
  static logError(error: VoiceError): void {
    const history = this.errorHistory.get(error.socketId) || [];
    history.push(error);
    this.errorHistory.set(error.socketId, history.slice(-10)); // Keep last 10 errors
    
    console.error(`[VoiceSocket Error] ${error.code}: ${error.message}`, {
      socketId: error.socketId,
      userId: error.userId,
      channelId: error.channelId,
      context: error.context
    });
  }
  
  static createError(
    code: VoiceErrorCode,
    message: string,
    socketId: string,
    userId?: string,
    channelId?: string,
    context?: any
  ): VoiceError {
    return {
      code,
      message,
      socketId,
      userId,
      channelId,
      timestamp: new Date(),
      context
    };
  }
  
  static getErrorHistory(socketId: string): VoiceError[] {
    return this.errorHistory.get(socketId) || [];
  }
  
  static clearErrorHistory(socketId: string): void {
    this.errorHistory.delete(socketId);
  }
  
  static setRecoveryState(socketId: string, state: RecoveryState): void {
    this.recoveryStates.set(socketId, state);
  }
  
  static getRecoveryState(socketId: string): RecoveryState | undefined {
    return this.recoveryStates.get(socketId);
  }
  
  static clearRecoveryState(socketId: string): void {
    this.recoveryStates.delete(socketId);
  }
}

class RetryManager {
  private static retryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2
  };
  
  static calculateDelay(attempt: number): number {
    const delay = this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt);
    return Math.min(delay, this.retryConfig.maxDelay);
  }
  
  static shouldRetry(attempt: number, error: VoiceError): boolean {
    if (attempt >= this.retryConfig.maxRetries) return false;
    
    // Don't retry authentication failures or permission denials
    const nonRetryableCodes = [
      VoiceErrorCode.AUTHENTICATION_FAILED,
      VoiceErrorCode.PERMISSION_DENIED,
      VoiceErrorCode.CHANNEL_FULL
    ];
    
    return !nonRetryableCodes.includes(error.code as VoiceErrorCode);
  }
  
  static async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string,
    socketId: string,
    userId?: string,
    channelId?: string
  ): Promise<T> {
    let lastError: VoiceError | undefined;
    
    for (let attempt = 0; attempt < this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = VoiceErrorHandler.createError(
          VoiceErrorCode.NETWORK_ERROR,
          `${context} failed on attempt ${attempt + 1}: ${error}`,
          socketId,
          userId,
          channelId,
          { attempt, originalError: error }
        );
        
        VoiceErrorHandler.logError(lastError);
        
        if (!this.shouldRetry(attempt, lastError)) {
          throw lastError;
        }
        
        const delay = this.calculateDelay(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    const exhaustedError = VoiceErrorHandler.createError(
      VoiceErrorCode.RETRY_EXHAUSTED,
      `${context} failed after ${this.retryConfig.maxRetries} attempts`,
      socketId,
      userId,
      channelId,
      { lastError }
    );
    
    VoiceErrorHandler.logError(exhaustedError);
    throw exhaustedError;
  }
}

export function setupVoiceSocket() {
  const channelUsers = new Map<string, string[]>(); // Map<channelId, socketId[]>
  
  // Enhanced media states to support advanced features
  interface MediaState {
    userId: string;
    muted: boolean;
    speaking: boolean;
    video: boolean;
    screenSharing: boolean;
    mediaQuality: 'low' | 'medium' | 'high' | 'auto';
    activeStreams: {
      audio: boolean;
      video: boolean;
      screen: boolean;
    };
    deviceInfo?: {
      audioInputs: number;
      videoInputs: number;
      activeAudioDevice?: string;
      activeVideoDevice?: string;
    };
    recordingState?: {
      isRecording: boolean;
      recordingId?: string;
      startTime?: Date;
    };
  }
  
  const voiceStates = new Map<string, MediaState>(); // Map<socketId, enhanced media state>
  
  // Connection state tracking
  const connectionStates = new Map<string, ConnectionState>();

  const io = getIO();

  if (io) {
    console.log("Voice Socket.IO instance set successfully.");
  }

  // Helper function to get userId from socketId using the shared map
  const getUserIdFromSocketId = (socketId: string): string | null => {
      for (const [key, value] of userSocketMap.entries()) {
          if (value === socketId) {
              return key;
          }
      }
      return null;
  };

  io.on('connection', (socket) => {
    console.log(`Voice Socket: User connected - ${socket.id}`);

    // Initialize connection state for the socket
    const initializeConnectionState = (userId: string, channelId: string) => {
      const state: ConnectionState = {
        socketId: socket.id,
        userId,
        channelId,
        joinedAt: new Date(),
        lastActivity: new Date(),
        retryCount: 0,
        isReconnecting: false
      };
      connectionStates.set(socket.id, state);
    };

    // Update connection activity
    const updateActivity = () => {
      const state = connectionStates.get(socket.id);
      if (state) {
        state.lastActivity = new Date();
        connectionStates.set(socket.id, state);
      }
    };

    // Enhanced join_voice_channel handler with error handling
    socket.on('join_voice_channel', async (channelId: string) => {
      try {
        updateActivity();
        
        const userId = getUserIdFromSocketId(socket.id);
        
        if (!userId) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.AUTHENTICATION_FAILED,
            'User not authenticated for voice channel',
            socket.id,
            undefined,
            channelId
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }

        // Initialize connection state
        initializeConnectionState(userId, channelId);
        
        // Check if the user is already in a channel.
        let existingChannelId: string | null = null;
        for (const [key, users] of channelUsers.entries()) {
          if (users.includes(socket.id)) {
            existingChannelId = key;
            break;
          }
        }

        // If the user is in a different channel, make them leave it first.
        if (existingChannelId && existingChannelId !== channelId) {
          console.log(`User ${socket.id} leaving old channel ${existingChannelId} to join new channel ${channelId}`);
          const usersInOldChannel = channelUsers.get(existingChannelId) || [];
          const updatedUsersInOldChannel = usersInOldChannel.filter(id => id !== socket.id);
          channelUsers.set(existingChannelId, updatedUsersInOldChannel);
          voiceStates.delete(socket.id);
          socket.leave(existingChannelId);
          usersInOldChannel.forEach(userSocketId => {
            io.to(userSocketId).emit('user-disconnected', {
              socketId: socket.id,
              userId,
              channelId: existingChannelId
            });
          });
        }

        socket.join(channelId);
        const usersInChannel = channelUsers.get(channelId) || [];

        // Notify all EXISTING users in the channel about the new user
        usersInChannel.forEach(existingUserSocketId => {
          const existingUserId = getUserIdFromSocketId(existingUserSocketId);
          if (existingUserId) {
            io.to(existingUserSocketId).emit('user-joined', {
              socketId: socket.id,
              userId: userId,
              channelId
            });
          }
        });
        
        // Update the channel user list and enhanced media state for the new user
        channelUsers.set(channelId, [...usersInChannel, socket.id]);
        voiceStates.set(socket.id, {
          userId,
          muted: false,
          speaking: false,
          video: false,
          screenSharing: false,
          mediaQuality: 'auto',
          activeStreams: {
            audio: true,
            video: false,
            screen: false
          }
        }); 

        // Send the enhanced 'roster' (list of existing members) to the new user
        const roster = usersInChannel.map(existingSocketId => {
          const state = voiceStates.get(existingSocketId);
          return {
            socketId: existingSocketId,
            userId: state?.userId,
            muted: state?.muted,
            speaking: state?.speaking,
            video: state?.video,
            screenSharing: state?.screenSharing,
            mediaQuality: state?.mediaQuality,
            activeStreams: state?.activeStreams,
            deviceInfo: state?.deviceInfo,
            isRecording: state?.recordingState?.isRecording || false
          };
        });
        
        socket.emit('voice_roster', { channelId, members: roster });
        
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.CHANNEL_JOIN_FAILED,
          `Failed to join voice channel: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // Enhanced WebRTC signaling handlers with error handling
    socket.on('webrtc-offer', ({ to, sdp, channelId }) => {
      try {
        updateActivity();
        
        if (!channelId || !to || !sdp) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'WebRTC offer is missing required fields',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { to, hasChannelId: !!channelId, hasSdp: !!sdp }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        // Verify both users are in the same channel
        const senderInChannel = channelUsers.get(channelId)?.includes(socket.id);
        const receiverInChannel = channelUsers.get(channelId)?.includes(to);
        
        if (!senderInChannel || !receiverInChannel) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.WEBRTC_SIGNALING_FAILED,
            'Users not in same voice channel for signaling',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { to, senderInChannel, receiverInChannel }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        io.to(to).emit('webrtc-offer', { from: socket.id, sdp, channelId });
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.WEBRTC_SIGNALING_FAILED,
          `WebRTC offer processing failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    socket.on('webrtc-answer', ({ to, sdp, channelId }) => {
      try {
        updateActivity();
        
        if (!channelId || !to || !sdp) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'WebRTC answer is missing required fields',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { to, hasChannelId: !!channelId, hasSdp: !!sdp }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        io.to(to).emit('webrtc-answer', { from: socket.id, sdp, channelId });
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.WEBRTC_SIGNALING_FAILED,
          `WebRTC answer processing failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    socket.on('webrtc-ice-candidate', ({ to, candidate, channelId }) => {
      try {
        updateActivity();
        
        if (!channelId || !to || !candidate) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'WebRTC ICE candidate is missing required fields',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { to, hasChannelId: !!channelId, hasCandidate: !!candidate }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        io.to(to).emit('webrtc-ice-candidate', { from: socket.id, candidate, channelId });
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.WEBRTC_SIGNALING_FAILED,
          `WebRTC ICE candidate processing failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // --- SCREEN SHARING WEBRTC SIGNALING ---
    
    // Screen sharing offer (separate from regular video)
    socket.on('screen-share-offer', ({ to, sdp, channelId }) => {
      try {
        updateActivity();
        
        if (!channelId || !to || !sdp) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Screen share offer is missing required fields',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { to, hasChannelId: !!channelId, hasSdp: !!sdp }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        // Verify both users are in the same channel
        const senderInChannel = channelUsers.get(channelId)?.includes(socket.id);
        const receiverInChannel = channelUsers.get(channelId)?.includes(to);
        
        if (!senderInChannel || !receiverInChannel) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.WEBRTC_SIGNALING_FAILED,
            'Users not in same channel for screen sharing',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { to, senderInChannel, receiverInChannel }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        // Update sender's screen sharing state
        const senderState = voiceStates.get(socket.id);
        if (senderState) {
          const updatedState = {
            ...senderState,
            screenSharing: true,
            activeStreams: {
              ...senderState.activeStreams,
              screen: true
            }
          };
          voiceStates.set(socket.id, updatedState);
        }
        
        io.to(to).emit('screen-share-offer', { from: socket.id, sdp, channelId });
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.WEBRTC_SIGNALING_FAILED,
          `Screen share offer processing failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // Screen sharing answer
    socket.on('screen-share-answer', ({ to, sdp, channelId }) => {
      try {
        updateActivity();
        
        if (!channelId || !to || !sdp) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Screen share answer is missing required fields',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { to, hasChannelId: !!channelId, hasSdp: !!sdp }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        io.to(to).emit('screen-share-answer', { from: socket.id, sdp, channelId });
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.WEBRTC_SIGNALING_FAILED,
          `Screen share answer processing failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // Screen sharing ICE candidates
    socket.on('screen-share-ice-candidate', ({ to, candidate, channelId }) => {
      try {
        updateActivity();
        
        if (!channelId || !to || !candidate) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Screen share ICE candidate is missing required fields',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { to, hasChannelId: !!channelId, hasCandidate: !!candidate }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        io.to(to).emit('screen-share-ice-candidate', { from: socket.id, candidate, channelId });
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.WEBRTC_SIGNALING_FAILED,
          `Screen share ICE candidate processing failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // --- NEW HANDLERS FROM FRONTEND ---

    // Handle when a user leaves the channel
    socket.on('leave_voice_channel', (channelId: string) => {
      try {
        updateActivity();
        
        if (!channelId) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Leave voice channel missing channelId',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            undefined
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        console.log(`User ${socket.id} leaving voice channel ${channelId}`);
        socket.leave(channelId);
        const users = channelUsers.get(channelId) || [];
        const updated = users.filter(id => id !== socket.id);
        channelUsers.set(channelId, updated);
        voiceStates.delete(socket.id);
        connectionStates.delete(socket.id);
        VoiceErrorHandler.clearErrorHistory(socket.id);
        VoiceErrorHandler.clearRecoveryState(socket.id);

        // Notify all remaining users that a user has left
        const leavingUserId = getUserIdFromSocketId(socket.id);
        updated.forEach(userIdInChannel => {
          io.to(userIdInChannel).emit('user-disconnected', { 
            socketId: socket.id,
            userId: leavingUserId,
            channelId
          });
        });
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.CHANNEL_JOIN_FAILED,
          `Failed to leave voice channel: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // Enhanced media state updates (voice, video, screen sharing, quality)
    socket.on('media_state_update', (data: { 
      channelId: string, 
      muted?: boolean, 
      speaking?: boolean, 
      video?: boolean,
      screenSharing?: boolean,
      mediaQuality?: 'low' | 'medium' | 'high' | 'auto',
      activeStreams?: {
        audio?: boolean;
        video?: boolean;
        screen?: boolean;
      }
    }) => {
      try {
        updateActivity();
        
        if (!data.channelId) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Media state update missing channelId',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            undefined,
            { receivedData: data }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        const state = voiceStates.get(socket.id);
        if (!state) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.STATE_UPDATE_FAILED,
            'No media state found for socket',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            data.channelId
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        // Update only the provided fields, keeping existing values for others
        const updatedState: MediaState = {
          ...state,
          ...(data.muted !== undefined && { muted: data.muted }),
          ...(data.speaking !== undefined && { speaking: data.speaking }),
          ...(data.video !== undefined && { video: data.video }),
          ...(data.screenSharing !== undefined && { screenSharing: data.screenSharing }),
          ...(data.mediaQuality !== undefined && { mediaQuality: data.mediaQuality }),
          ...(data.activeStreams && {
            activeStreams: {
              ...state.activeStreams,
              ...data.activeStreams
            }
          })
        };
        
        voiceStates.set(socket.id, updatedState);
        
        // Broadcast the state change to everyone else in the channel
        io.to(data.channelId).emit('user_media_state', {
          socketId: socket.id,
          userId: state.userId,
          muted: updatedState.muted,
          speaking: updatedState.speaking,
          video: updatedState.video,
          screenSharing: updatedState.screenSharing,
          mediaQuality: updatedState.mediaQuality,
          activeStreams: updatedState.activeStreams
        });
        
        // Handle screen sharing start/stop notifications
        if (data.screenSharing !== undefined) {
          const action = data.screenSharing ? 'started' : 'stopped';
          io.to(data.channelId).emit('screen_sharing_update', {
            socketId: socket.id,
            userId: state.userId,
            action,
            isScreenSharing: data.screenSharing
          });
        }
        
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.STATE_UPDATE_FAILED,
          `Media state update failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          data?.channelId,
          { originalError: error, receivedData: data }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // Legacy voice_state_update handler for backward compatibility
    socket.on('voice_state_update', (data: { channelId: string, muted: boolean, speaking: boolean, video: boolean }) => {
      // Handle legacy format directly with enhanced logic
      try {
        updateActivity();
        
        if (!data.channelId) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Legacy voice state update missing channelId',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            undefined,
            { receivedData: data }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        const state = voiceStates.get(socket.id);
        if (!state) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.STATE_UPDATE_FAILED,
            'No voice state found for socket (legacy)',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            data.channelId
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        const updatedState: MediaState = {
          ...state,
          muted: data.muted,
          speaking: data.speaking,
          video: data.video
        };
        
        voiceStates.set(socket.id, updatedState);
        
        // Broadcast using legacy format for compatibility
        io.to(data.channelId).emit('user_voice_state', {
          socketId: socket.id,
          userId: state.userId,
          muted: data.muted,
          speaking: data.speaking,
          video: data.video
        });
        
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.STATE_UPDATE_FAILED,
          `Legacy voice state update failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          data?.channelId,
          { originalError: error, receivedData: data }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // --- MULTIPLE TRACKS AND DEVICE MANAGEMENT ---
    
    // Device enumeration and switching
    socket.on('update_device_info', ({ channelId, deviceInfo }: {
      channelId: string;
      deviceInfo: {
        audioInputs: number;
        videoInputs: number;
        activeAudioDevice?: string;
        activeVideoDevice?: string;
      }
    }) => {
      try {
        updateActivity();
        
        if (!channelId) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Device info update missing channelId',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            undefined,
            { receivedData: { channelId, deviceInfo } }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        const state = voiceStates.get(socket.id);
        if (state) {
          const updatedState: MediaState = {
            ...state,
            deviceInfo
          };
          voiceStates.set(socket.id, updatedState);
          
          // Notify channel members about device capabilities
          io.to(channelId).emit('user_device_update', {
            socketId: socket.id,
            userId: state.userId,
            deviceInfo
          });
        }
      } catch (error) {
        console.error('Device info update error:', error);
      }
    });

    // Track replacement (switching cameras/microphones)
    socket.on('replace_track', ({ to, channelId, trackType, trackId }: {
      to: string;
      channelId: string;
      trackType: 'audio' | 'video';
      trackId: string;
    }) => {
      try {
        updateActivity();
        
        if (!channelId || !to || !trackType) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Track replacement missing required fields',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { to, trackType, trackId }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        // Forward track replacement signal
        io.to(to).emit('replace_track', {
          from: socket.id,
          channelId,
          trackType,
          trackId
        });
        
        // Update state if needed
        const state = voiceStates.get(socket.id);
        if (state && state.deviceInfo) {
          if (trackType === 'audio') {
            state.deviceInfo.activeAudioDevice = trackId;
          } else if (trackType === 'video') {
            state.deviceInfo.activeVideoDevice = trackId;
          }
          voiceStates.set(socket.id, state);
        }
        
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.WEBRTC_SIGNALING_FAILED,
          `Track replacement failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // Multiple track management
    socket.on('add_track', ({ to, channelId, trackType, trackInfo }: {
      to: string;
      channelId: string;
      trackType: 'audio' | 'video' | 'screen';
      trackInfo: any;
    }) => {
      try {
        updateActivity();
        
        if (!channelId || !to || !trackType) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Add track missing required fields',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { to, trackType }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        // Forward new track signal
        io.to(to).emit('add_track', {
          from: socket.id,
          channelId,
          trackType,
          trackInfo
        });
        
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.WEBRTC_SIGNALING_FAILED,
          `Add track failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // Remove track
    socket.on('remove_track', ({ to, channelId, trackType, trackId }: {
      to: string;
      channelId: string;
      trackType: 'audio' | 'video' | 'screen';
      trackId: string;
    }) => {
      try {
        updateActivity();
        
        if (!channelId || !to || !trackType) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Remove track missing required fields',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { to, trackType, trackId }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        // Forward track removal signal
        io.to(to).emit('remove_track', {
          from: socket.id,
          channelId,
          trackType,
          trackId
        });
        
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.WEBRTC_SIGNALING_FAILED,
          `Remove track failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // --- RECORDING CAPABILITIES ---
    
    // Start recording session
    socket.on('start_recording', ({ channelId, recordingConfig }: {
      channelId: string;
      recordingConfig?: {
        includeAudio: boolean;
        includeVideo: boolean;
        includeScreenShare: boolean;
        quality: 'low' | 'medium' | 'high';
      }
    }) => {
      try {
        updateActivity();
        
        if (!channelId) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Start recording missing channelId',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            undefined,
            { recordingConfig }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        const userId = getUserIdFromSocketId(socket.id);
        if (!userId) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.AUTHENTICATION_FAILED,
            'User not authenticated for recording',
            socket.id,
            undefined,
            channelId
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        // Check if user has permission to record (in a real app, you'd check server ownership/admin roles)
        const state = voiceStates.get(socket.id);
        if (!state) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.STATE_UPDATE_FAILED,
            'No user state found for recording',
            socket.id,
            userId,
            channelId
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        // Generate recording ID and update state
        const recordingId = `rec_${Date.now()}_${socket.id}`;
        const updatedState: MediaState = {
          ...state,
          recordingState: {
            isRecording: true,
            recordingId,
            startTime: new Date()
          }
        };
        voiceStates.set(socket.id, updatedState);
        
        // Notify all users in channel that recording has started
        io.to(channelId).emit('recording_started', {
          recordingId,
          startedBy: {
            socketId: socket.id,
            userId
          },
          config: recordingConfig || {
            includeAudio: true,
            includeVideo: true,
            includeScreenShare: true,
            quality: 'medium'
          }
        });
        
        // Confirm to recorder
        socket.emit('recording_started_confirmation', {
          recordingId,
          message: 'Recording started successfully'
        });
        
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.STATE_UPDATE_FAILED,
          `Start recording failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // Stop recording session
    socket.on('stop_recording', ({ channelId, recordingId }: {
      channelId: string;
      recordingId: string;
    }) => {
      try {
        updateActivity();
        
        if (!channelId || !recordingId) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Stop recording missing required fields',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { recordingId }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        const state = voiceStates.get(socket.id);
        if (!state || !state.recordingState || state.recordingState.recordingId !== recordingId) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.STATE_UPDATE_FAILED,
            'No matching recording session found',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { requestedRecordingId: recordingId, currentState: state?.recordingState }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        // Calculate recording duration
        const duration = Date.now() - (state.recordingState.startTime?.getTime() || Date.now());
        
        // Update state
        const updatedState: MediaState = {
          ...state,
          recordingState: undefined
        };
        voiceStates.set(socket.id, updatedState);
        
        // Notify all users in channel that recording has stopped
        io.to(channelId).emit('recording_stopped', {
          recordingId,
          duration,
          stoppedBy: {
            socketId: socket.id,
            userId: getUserIdFromSocketId(socket.id)
          }
        });
        
        // Confirm to recorder
        socket.emit('recording_stopped_confirmation', {
          recordingId,
          duration,
          message: 'Recording stopped successfully'
        });
        
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.STATE_UPDATE_FAILED,
          `Stop recording failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // Recording chunk data (for server-side recording storage)
    socket.on('recording_chunk', ({ recordingId, chunkData, chunkIndex }: {
      recordingId: string;
      chunkData: string; // Base64 encoded audio/video data
      chunkIndex: number;
    }) => {
      try {
        updateActivity();
        
        const state = voiceStates.get(socket.id);
        if (!state || !state.recordingState || state.recordingState.recordingId !== recordingId) {
          console.warn(`Invalid recording chunk received from ${socket.id}`);
          return;
        }
        
        // In a production app, you would:
        // 1. Validate the chunk data
        // 2. Store it in a file system or cloud storage
        // 3. Process and merge chunks
        // 4. Generate final recording file
        
        console.log(`Recording chunk ${chunkIndex} received for recording ${recordingId}`);
        
        // Acknowledge chunk receipt
        socket.emit('recording_chunk_ack', {
          recordingId,
          chunkIndex,
          status: 'received'
        });
        
      } catch (error) {
        console.error('Recording chunk processing error:', error);
        socket.emit('recording_chunk_error', {
          recordingId,
          chunkIndex,
          error: 'Failed to process recording chunk'
        });
      }
    });

    // --- BANDWIDTH OPTIMIZATION AND ADAPTIVE QUALITY ---
    
    // Enhanced network quality monitoring with adaptive bitrate
    socket.on('network_quality_update', (quality: NetworkQuality) => {
      try {
        updateActivity();
        
        const connectionState = connectionStates.get(socket.id);
        const mediaState = voiceStates.get(socket.id);
        
        if (connectionState && mediaState) {
          let recommendedQuality: 'low' | 'medium' | 'high' = 'medium';
          let adaptiveActions: string[] = [];
          
          // Determine recommended quality based on network conditions
          switch (quality.connectionType) {
            case 'excellent':
              recommendedQuality = 'high';
              break;
            case 'good':
              recommendedQuality = 'medium';
              break;
            case 'poor':
              recommendedQuality = 'low';
              adaptiveActions.push('Reduced video quality to preserve connection');
              break;
            case 'critical':
              recommendedQuality = 'low';
              adaptiveActions.push('Consider disabling video to improve audio quality');
              
              // Prepare for potential reconnection
              const recoveryState: RecoveryState = {
                socketId: socket.id,
                channelId: connectionState.channelId,
                userId: connectionState.userId,
                voiceState: {
                  muted: mediaState.muted,
                  speaking: mediaState.speaking,
                  video: mediaState.video
                },
                reconnectionAttempts: 0,
                lastConnectionTime: new Date(),
              };
              VoiceErrorHandler.setRecoveryState(socket.id, recoveryState);
              break;
          }
          
          // Auto-adjust media quality if enabled
          if (mediaState.mediaQuality === 'auto') {
            const updatedState: MediaState = {
              ...mediaState,
              mediaQuality: recommendedQuality
            };
            voiceStates.set(socket.id, updatedState);
            
            // Notify user of quality change
            socket.emit('quality_auto_adjusted', {
              newQuality: recommendedQuality,
              reason: `Adjusted due to ${quality.connectionType} network conditions`,
              networkStats: quality
            });
            
            // Notify channel members of user's quality change
            io.to(connectionState.channelId).emit('user_quality_changed', {
              socketId: socket.id,
              userId: connectionState.userId,
              newQuality: recommendedQuality,
              networkCondition: quality.connectionType
            });
          }
          
          // Send degradation warnings for poor connections
          if (quality.connectionType === 'critical' || quality.connectionType === 'poor') {
            socket.emit('voice_quality_degraded', {
              severity: quality.connectionType === 'critical' ? 'high' : 'medium',
              message: `${quality.connectionType === 'critical' ? 'Critical' : 'Poor'} network quality detected.`,
              recommendations: [
                'Check your internet connection',
                'Close other bandwidth-intensive applications',
                ...(quality.connectionType === 'critical' ? ['Consider switching to audio-only mode'] : []),
                ...adaptiveActions
              ],
              networkStats: quality,
              suggestedQuality: recommendedQuality
            });
          }
        }
      } catch (error) {
        console.error('Network quality update error:', error);
      }
    });

    // Bandwidth usage reporting
    socket.on('bandwidth_stats', ({ channelId, stats }: {
      channelId: string;
      stats: {
        bytesReceived: number;
        bytesSent: number;
        packetsLost: number;
        rtt: number; // Round trip time
        jitter: number;
        timestamp: number;
      }
    }) => {
      try {
        updateActivity();
        
        if (!channelId) {
          return;
        }
        
        const state = voiceStates.get(socket.id);
        if (state) {
          // Calculate bandwidth efficiency
          const totalBytes = stats.bytesReceived + stats.bytesSent;
          const efficiency = stats.packetsLost > 0 ? 
            ((totalBytes - stats.packetsLost * 1024) / totalBytes) * 100 : 100;
          
          // Suggest optimizations based on stats
          const suggestions: string[] = [];
          
          if (stats.rtt > 200) {
            suggestions.push('High latency detected - consider reducing video quality');
          }
          
          if (stats.jitter > 50) {
            suggestions.push('Network jitter detected - enable adaptive quality');
          }
          
          if (efficiency < 95) {
            suggestions.push('Packet loss detected - switch to lower quality');
          }
          
          if (suggestions.length > 0) {
            socket.emit('bandwidth_optimization_suggestions', {
              currentStats: stats,
              efficiency: efficiency.toFixed(2),
              suggestions
            });
          }
          
          // Log stats for monitoring (in production, you might store these)
          console.log(`Bandwidth stats for ${socket.id}: RTT=${stats.rtt}ms, Jitter=${stats.jitter}ms, Efficiency=${efficiency.toFixed(2)}%`);
        }
      } catch (error) {
        console.error('Bandwidth stats processing error:', error);
      }
    });

    // Manual quality adjustment
    socket.on('adjust_quality', ({ channelId, targetQuality, reason }: {
      channelId: string;
      targetQuality: 'low' | 'medium' | 'high' | 'auto';
      reason?: string;
    }) => {
      try {
        updateActivity();
        
        if (!channelId || !targetQuality) {
          const error = VoiceErrorHandler.createError(
            VoiceErrorCode.INVALID_DATA,
            'Quality adjustment missing required fields',
            socket.id,
            getUserIdFromSocketId(socket.id) || undefined,
            channelId,
            { targetQuality, reason }
          );
          VoiceErrorHandler.logError(error);
          socket.emit('voice_error', error);
          return;
        }
        
        const state = voiceStates.get(socket.id);
        if (state) {
          const updatedState: MediaState = {
            ...state,
            mediaQuality: targetQuality
          };
          voiceStates.set(socket.id, updatedState);
          
          // Confirm quality change
          socket.emit('quality_adjusted', {
            newQuality: targetQuality,
            reason: reason || 'Manual adjustment'
          });
          
          // Notify channel members
          io.to(channelId).emit('user_quality_changed', {
            socketId: socket.id,
            userId: state.userId,
            newQuality: targetQuality,
            isManual: true
          });
        }
      } catch (error) {
        const voiceError = VoiceErrorHandler.createError(
          VoiceErrorCode.STATE_UPDATE_FAILED,
          `Quality adjustment failed: ${error}`,
          socket.id,
          getUserIdFromSocketId(socket.id) || undefined,
          channelId,
          { originalError: error }
        );
        VoiceErrorHandler.logError(voiceError);
        socket.emit('voice_error', voiceError);
      }
    });

    // Bitrate recommendations based on channel load
    socket.on('request_optimal_bitrate', ({ channelId }: { channelId: string }) => {
      try {
        updateActivity();
        
        if (!channelId) {
          return;
        }
        
        const usersInChannel = channelUsers.get(channelId) || [];
        const activeVideoUsers = usersInChannel.filter(socketId => {
          const state = voiceStates.get(socketId);
          return state?.video || state?.screenSharing;
        }).length;
        
        const activeAudioUsers = usersInChannel.filter(socketId => {
          const state = voiceStates.get(socketId);
          return state?.activeStreams.audio;
        }).length;
        
        // Calculate recommended bitrates based on channel load
        let recommendedAudioBitrate = 64; // kbps base
        let recommendedVideoBitrate = 1000; // kbps base
        
        // Adjust based on number of users
        if (activeAudioUsers > 5) {
          recommendedAudioBitrate = Math.max(32, recommendedAudioBitrate - (activeAudioUsers - 5) * 8);
        }
        
        if (activeVideoUsers > 3) {
          recommendedVideoBitrate = Math.max(500, recommendedVideoBitrate - (activeVideoUsers - 3) * 150);
        }
        
        socket.emit('optimal_bitrate_recommendation', {
          channelId,
          channelLoad: {
            totalUsers: usersInChannel.length,
            activeVideoUsers,
            activeAudioUsers
          },
          recommendations: {
            audioBitrate: recommendedAudioBitrate,
            videoBitrate: recommendedVideoBitrate,
            reasoning: `Optimized for ${usersInChannel.length} users (${activeVideoUsers} video, ${activeAudioUsers} audio)`
          }
        });
        
      } catch (error) {
        console.error('Bitrate recommendation error:', error);
      }
    });

    // Handle reconnection attempts
    socket.on('reconnect_attempt', () => {
      try {
        const recoveryState = VoiceErrorHandler.getRecoveryState(socket.id);
        if (recoveryState) {
          recoveryState.reconnectionAttempts++;
          recoveryState.recoveryStartTime = recoveryState.recoveryStartTime || new Date();
          VoiceErrorHandler.setRecoveryState(socket.id, recoveryState);
          
          // If too many attempts, suggest fallback
          if (recoveryState.reconnectionAttempts > 5) {
            socket.emit('voice_reconnection_failed', {
              message: 'Multiple reconnection attempts failed',
              fallbackOptions: ['Refresh the page', 'Switch to text chat temporarily']
            });
          }
        }
      } catch (error) {
        console.error('Reconnection attempt handling error:', error);
      }
    });

    // The enhanced disconnect handler with recovery state management
    socket.on('disconnect', () => {
      try {
        console.log(`Socket disconnected: ${socket.id}`);
        const disconnectedUserId = getUserIdFromSocketId(socket.id);

        // Find the channel the user was in and notify others
        for (const [channelId, users] of channelUsers.entries()) {
          if (users.includes(socket.id)) {
            const updated = users.filter(id => id !== socket.id);
            channelUsers.set(channelId, updated);
            
            // Clean up all state
            voiceStates.delete(socket.id);
            connectionStates.delete(socket.id);
            VoiceErrorHandler.clearErrorHistory(socket.id);
            VoiceErrorHandler.clearRecoveryState(socket.id);

            // Emit to the remaining users in that specific channel
            updated.forEach(userIdInChannel => {
              io.to(userIdInChannel).emit('user-disconnected', { 
                socketId: socket.id,
                userId: disconnectedUserId,
                channelId
              });
            });
            break; // Stop the loop since we found the user
          }
        }
      } catch (error) {
        console.error('Disconnect handler error:', error);
      }
    });
  });
}