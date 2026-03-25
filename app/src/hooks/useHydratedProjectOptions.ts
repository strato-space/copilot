import { useEffect, useMemo } from 'react';

import { useProjectsStore } from '../store/projectsStore';
import {
  buildGroupedProjectOptions,
  hydrateProjectsWithRelations,
  projectHierarchyLabel,
  projectDisplayName,
  projectIdentityTokens,
  projectOptionValue,
  type GroupedSelectOption,
  type ProjectOptionSource,
} from '../utils/projectSelectOptions';

type ProjectLabelMap = Map<string, string>;

interface HydratedProjectOptionsResult {
  hydratedProjects: ProjectOptionSource[];
  groupedProjectOptions: GroupedSelectOption[];
  projectLabelById: ProjectLabelMap;
  projectHierarchyLabelById: ProjectLabelMap;
}

export const useHydratedProjectOptions = (
  projectsLike: ProjectOptionSource[] | null | undefined
): HydratedProjectOptionsResult => {
  const { customers, projectGroups, projects, fetchCustomers, fetchProjectGroups, fetchProjects } = useProjectsStore();

  useEffect(() => {
    if (!Array.isArray(customers) || customers.length === 0) {
      void fetchCustomers();
    }
    if (!Array.isArray(projectGroups) || projectGroups.length === 0) {
      void fetchProjectGroups();
    }
    if (!Array.isArray(projects) || projects.length === 0) {
      void fetchProjects();
    }
  }, [customers, fetchCustomers, fetchProjectGroups, fetchProjects, projectGroups, projects]);

  const canonicalProjects = useMemo(
    () => hydrateProjectsWithRelations(projects, projectGroups, customers),
    [customers, projectGroups, projects]
  );

  const hydratedInputProjects = useMemo(
    () => hydrateProjectsWithRelations(projectsLike, projectGroups, customers),
    [customers, projectGroups, projectsLike]
  );

  const hydratedProjects = useMemo(() => {
    const preferredSource = canonicalProjects.length > 0 ? canonicalProjects : hydratedInputProjects;
    if (!Array.isArray(projectsLike) || projectsLike.length === 0) {
      return preferredSource;
    }

    const allowedValues = new Set<string>();
    for (const project of projectsLike) {
      for (const token of projectIdentityTokens(project)) {
        allowedValues.add(token);
      }
    }

    const filteredPreferred = preferredSource.filter((project) => {
      return projectIdentityTokens(project).some((token) => allowedValues.has(token));
    });

    if (filteredPreferred.length === 0) {
      return hydratedInputProjects;
    }

    const seen = new Set(
      filteredPreferred.flatMap((project) => {
        return projectIdentityTokens(project);
      })
    );

    const merged = [...filteredPreferred];
    for (const project of hydratedInputProjects) {
      if (projectIdentityTokens(project).some((token) => seen.has(token))) continue;
      merged.push(project);
    }
    return merged;
  }, [canonicalProjects, customers, hydratedInputProjects, projectGroups, projectsLike]);

  const groupedProjectOptions = useMemo(
    () => buildGroupedProjectOptions(hydratedProjects),
    [hydratedProjects]
  );

  const projectLabelById = useMemo<ProjectLabelMap>(
    () =>
      new Map(
        hydratedProjects
          .map((project) => [projectOptionValue(project), projectDisplayName(project)] as const)
          .filter(([id]) => id.length > 0)
      ),
    [hydratedProjects]
  );

  const projectHierarchyLabelById = useMemo<ProjectLabelMap>(
    () =>
      new Map(
        hydratedProjects
          .map((project) => [projectOptionValue(project), projectHierarchyLabel(project)] as const)
          .filter(([id]) => id.length > 0)
      ),
    [hydratedProjects]
  );

  return {
    hydratedProjects,
    groupedProjectOptions,
    projectLabelById,
    projectHierarchyLabelById,
  };
};
