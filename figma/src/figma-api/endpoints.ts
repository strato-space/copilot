import type { FigmaApiFile, FigmaApiFileResponse, FigmaApiProject } from '../types/figma.js';
import { figmaGet } from './client.js';

export interface TeamProjectsResponse {
  projects?: FigmaApiProject[];
}

export interface ProjectFilesResponse {
  files?: FigmaApiFile[];
}

export const getTeamProjects = async (teamId: string): Promise<FigmaApiProject[]> => {
  const response = await figmaGet<TeamProjectsResponse>(`/teams/${encodeURIComponent(teamId)}/projects`);
  return response.projects ?? [];
};

export const getProjectFiles = async (projectId: string): Promise<FigmaApiFile[]> => {
  const response = await figmaGet<ProjectFilesResponse>(`/projects/${encodeURIComponent(projectId)}/files`);
  return response.files ?? [];
};

export const getFileTree = async (fileKey: string, depth: number): Promise<FigmaApiFileResponse> => {
  return figmaGet<FigmaApiFileResponse>(`/files/${encodeURIComponent(fileKey)}?depth=${depth}`);
};
