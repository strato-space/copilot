import type { FigmaApiFile, FigmaApiProject } from '../types/figma.js';

export const mapProjectName = (project: FigmaApiProject): string => project.name.trim();

export const mapFileVersion = (file: FigmaApiFile): string | null => file.version ?? null;

export const mapFileLastModified = (file: FigmaApiFile): string | null => file.last_modified ?? null;

export const mapFileThumbnail = (file: FigmaApiFile): string | null => file.thumbnail_url ?? null;
