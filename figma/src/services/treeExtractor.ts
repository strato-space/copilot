import type {
  FigmaApiFileResponse,
  FigmaApiNode,
  FigmaNodeFlatDoc,
  FigmaTreePage,
  FigmaTreeSection,
  FigmaTreeSnapshot,
} from '../types/figma.js';

const sanitizeName = (name: string | undefined, fallback: string): string => {
  const trimmed = name?.trim();
  return trimmed ? trimmed : fallback;
};

const buildSection = (pageName: string, section: FigmaApiNode): FigmaTreeSection => {
  const name = sanitizeName(section.name, 'Untitled section');
  return {
    node_id: section.id,
    name,
    node_type: 'SECTION',
    path: `${pageName} / ${name}`,
  };
};

const buildPage = (page: FigmaApiNode): FigmaTreePage => {
  const pageName = sanitizeName(page.name, 'Untitled page');
  const sections = (page.children ?? [])
    .filter((child) => child.type === 'SECTION')
    .map((section) => buildSection(pageName, section));

  return {
    node_id: page.id,
    name: pageName,
    node_type: 'PAGE',
    path: pageName,
    sections,
  };
};

export const extractFileTreeSnapshot = ({
  fileKey,
  fileName,
  depth,
  response,
}: {
  fileKey: string;
  fileName: string;
  depth: number;
  response: FigmaApiFileResponse;
}): FigmaTreeSnapshot => {
  const pages = (response.document?.children ?? [])
    .filter((node) => node.type === 'CANVAS')
    .map((page) => buildPage(page));

  return {
    file_key: fileKey,
    file_name: sanitizeName(fileName, response.name ?? fileKey),
    version: response.version ?? null,
    depth,
    pages,
  };
};

export const flattenTreeSnapshot = (snapshot: FigmaTreeSnapshot): FigmaNodeFlatDoc[] => {
  const createdAt = Date.now();
  const rows: FigmaNodeFlatDoc[] = [
    {
      file_key: snapshot.file_key,
      version: snapshot.version,
      node_id: snapshot.file_key,
      parent_node_id: null,
      node_type: 'FILE' as const,
      name: snapshot.file_name,
      page_node_id: null,
      page_name: null,
      section_node_id: null,
      section_name: null,
      path: snapshot.file_name,
      created_at: createdAt,
    },
  ];

  for (const page of snapshot.pages) {
    rows.push({
      file_key: snapshot.file_key,
      version: snapshot.version,
      node_id: page.node_id,
      parent_node_id: snapshot.file_key,
      node_type: 'PAGE' as const,
      name: page.name,
      page_node_id: page.node_id,
      page_name: page.name,
      section_node_id: null,
      section_name: null,
      path: page.path,
      created_at: createdAt,
    });

    for (const section of page.sections) {
      rows.push({
        file_key: snapshot.file_key,
        version: snapshot.version,
        node_id: section.node_id,
        parent_node_id: page.node_id,
        node_type: 'SECTION' as const,
        name: section.name,
        page_node_id: page.node_id,
        page_name: page.name,
        section_node_id: section.node_id,
        section_name: section.name,
        path: section.path,
        created_at: createdAt,
      });
    }
  }

  return rows;
};
