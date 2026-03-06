import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Express } from 'express';

import { AppError } from '../../src/api/middleware/error.js';
import {
  createTaskAttachmentFromUpload,
  getTaskAttachmentsTempDir,
  normalizeTaskAttachments,
  resolveTaskAttachmentAbsolutePath,
} from '../../src/services/taskAttachments.js';

describe('taskAttachments service', () => {
  let attachmentsDir: string;

  beforeEach(() => {
    attachmentsDir = mkdtempSync(join(tmpdir(), 'copilot-task-attachments-'));
    process.env.TASK_ATTACHMENTS_DIR = attachmentsDir;
  });

  afterEach(() => {
    rmSync(attachmentsDir, { recursive: true, force: true });
    delete process.env.TASK_ATTACHMENTS_DIR;
  });

  test('creates canonical attachment metadata and stores file under managed root', () => {
    const tempPath = join(getTaskAttachmentsTempDir(), 'test-file.pdf');
    writeFileSync(tempPath, 'pdf-content');

    const attachment = createTaskAttachmentFromUpload({
      file: {
        path: tempPath,
        originalname: 'Specification.pdf',
        mimetype: 'application/pdf',
        size: 11,
      } as Express.Multer.File,
      uploadedBy: 'tester',
      uploadedVia: 'crm',
    });

    expect(attachment.attachment_id).toBeTruthy();
    expect(attachment.file_name).toBe('Specification.pdf');
    expect(attachment.mime_type).toBe('application/pdf');
    expect(attachment.uploaded_via).toBe('crm');

    const resolvedPath = resolveTaskAttachmentAbsolutePath(attachment);
    expect(existsSync(resolvedPath)).toBe(true);
    expect(existsSync(tempPath)).toBe(false);
  });

  test('decodes utf8 filenames that busboy exposed as latin1 mojibake', () => {
    const tempPath = join(getTaskAttachmentsTempDir(), 'prompt-file.txt');
    writeFileSync(tempPath, 'prompt-content');

    const attachment = createTaskAttachmentFromUpload({
      file: {
        path: tempPath,
        originalname: 'ÐÑÐ¾Ð¼Ð¿Ñ Ð°Ð³ÐµÐ½Ñ.txt',
        mimetype: 'text/plain',
        size: 14,
      } as Express.Multer.File,
      uploadedVia: 'crm',
    });

    expect(attachment.file_name).toBe('Промпт агент.txt');
    expect(attachment.storage_key).toMatch(/^files\/\d{4}\/\d{2}\/\d{2}\/.+\.txt$/);
  });

  test('rejects unsupported file extension/mime', () => {
    const tempPath = join(getTaskAttachmentsTempDir(), 'forbidden.exe');
    writeFileSync(tempPath, 'binary-content');

    expect(() =>
      createTaskAttachmentFromUpload({
        file: {
          path: tempPath,
          originalname: 'forbidden.exe',
          mimetype: 'application/octet-stream',
          size: 64,
        } as Express.Multer.File,
        uploadedVia: 'miniapp',
      })
    ).toThrow(AppError);
  });

  test('normalizes only valid canonical attachments', () => {
    const result = normalizeTaskAttachments([
      {
        attachment_id: 'a1',
        file_name: 'ÐÑÐ¾Ð¼Ð¿Ñ Ð°Ð³ÐµÐ½Ñ.txt',
        mime_type: 'text/plain',
        file_size: 12,
        storage_key: 'files/2026/03/05/a1-prompt.txt',
        uploaded_at: new Date('2026-03-05T12:00:00.000Z').toISOString(),
      },
      {
        attachment_id: 'a1-legacy',
        file_name: 'first.pdf',
        mime_type: 'application/pdf',
        file_size: 12,
        storage_key: 'files/2026/03/05/a1-first.pdf',
        uploaded_at: new Date('2026-03-05T12:00:00.000Z').toISOString(),
      },
      {
        attachment_id: 'a2',
        file_name: 'broken.exe',
        mime_type: 'application/octet-stream',
        file_size: 12,
        storage_key: 'files/2026/03/05/a2-broken.exe',
        uploaded_at: new Date('2026-03-05T12:00:00.000Z').toISOString(),
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]?.attachment_id).toBe('a1');
    expect(result[0]?.file_name).toBe('Промпт агент.txt');
    expect(result[1]?.attachment_id).toBe('a1-legacy');
  });
});
