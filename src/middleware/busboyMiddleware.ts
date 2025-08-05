import { Request, Response, NextFunction } from 'express';
import { Readable } from 'stream';
import busboy from 'busboy';

export interface RequestWithBusboy extends Request {
  busboyFile?: {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    buffer: Buffer;
    size: number;
  };
}

export const busboyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
    return next();
  }

  const reqWithBusboy = req as RequestWithBusboy;
  reqWithBusboy.body = reqWithBusboy.body || {};

  const bb = busboy({ headers: req.headers });

  bb.on('field', (name: string, value: string) => {
    reqWithBusboy.body[name] = value;
  });

  bb.on('file', (name: string, fileStream: Readable, info: busboy.FileInfo) => {
    const { filename, encoding, mimeType } = info;
    
    const chunks: Buffer[] = [];
    let fileSize = 0;

    fileStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      fileSize += chunk.length;
    });

    fileStream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      
      reqWithBusboy.busboyFile = {
        fieldname: name,
        originalname: filename,
        encoding: encoding,
        mimetype: mimeType,
        buffer: buffer,
        size: fileSize,
      };
    });
  });

  // Event listener for when parsing is fully complete
  bb.on('finish', () => {
    // We wait for 'finish' to ensure all fields and files are processed
    // before passing control to the controller.
    next();
  });

  // Event listener for any parsing errors
  bb.on('error', (err: Error) => {
    next(err);
  });

  // Start the process by piping the request stream into busboy
  req.pipe(bb);
};