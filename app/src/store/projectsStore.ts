/**
 * Projects Store - Projects Tree management
 * Migrated from appkanban/src/store/projects.js
 */

import { create } from 'zustand';
import { useRequestStore } from './requestStore';
import type { Customer, ProjectGroup, ProjectWithGroup, TreeNode } from '../types/crm';

interface ProjectsState {
    customers: Customer[];
    projectGroups: ProjectGroup[];
    projects: ProjectWithGroup[];
    loading: boolean;
    tree: TreeNode[];

    fetchCustomers: () => Promise<void>;
    fetchProjectGroups: () => Promise<void>;
    fetchProjects: () => Promise<void>;
    buildTree: () => TreeNode[];

    createCustomer: (name: string) => Promise<unknown>;
    updateCustomer: (id: string, name: string) => Promise<unknown>;

    createProjectGroup: (name: string, customer: string) => Promise<unknown>;
    updateProjectGroup: (id: string, name: string, customer: string) => Promise<unknown>;
    moveProjectGroup: (projectGroupNode: TreeNode, sourceCustomer: Customer, destCustomer: Customer) => Promise<unknown>;

    moveProject: (projectNode: TreeNode, sourceProjectGroup: ProjectGroup, destProjectGroup: ProjectGroup) => Promise<unknown>;
    createProject: (projectData: Partial<ProjectWithGroup> & { project_group?: string }) => Promise<unknown>;
    updateProject: (id: string, projectData: Partial<ProjectWithGroup>) => Promise<unknown>;
}

export const useProjectsStore = create<ProjectsState>((set, get) => {
    const api_request = useRequestStore.getState().api_request;
    let isFetchingCustomers = false;
    let lastCustomersFetchAt = 0;
    let isFetchingProjectGroups = false;
    let lastProjectGroupsFetchAt = 0;
    let isFetchingProjects = false;
    let lastProjectsFetchAt = 0;

    return {
        customers: [],
        projectGroups: [],
        projects: [],
        loading: false,
        tree: [],

        fetchCustomers: async () => {
            const now = Date.now();
            if (isFetchingCustomers || now - lastCustomersFetchAt < 5000) return;
            isFetchingCustomers = true;
            lastCustomersFetchAt = now;
            set({ loading: true });
            try {
                const res = await api_request<Customer[]>('customers/list', {});
                set({ customers: res ?? [], loading: false });
            } catch (error) {
                console.error('Error fetching customers:', error);
                set({ loading: false });
            } finally {
                isFetchingCustomers = false;
            }
        },

        fetchProjectGroups: async () => {
            const now = Date.now();
            if (isFetchingProjectGroups || now - lastProjectGroupsFetchAt < 5000) return;
            isFetchingProjectGroups = true;
            lastProjectGroupsFetchAt = now;
            set({ loading: true });
            try {
                const res = await api_request<ProjectGroup[]>('project_groups/list', {});
                set({ projectGroups: res ?? [], loading: false });
            } catch (error) {
                console.error('Error fetching project groups:', error);
                set({ loading: false });
            } finally {
                isFetchingProjectGroups = false;
            }
        },

        fetchProjects: async () => {
            const now = Date.now();
            if (isFetchingProjects || now - lastProjectsFetchAt < 5000) return;
            isFetchingProjects = true;
            lastProjectsFetchAt = now;
            set({ loading: true });
            try {
                const res = await api_request<ProjectWithGroup[]>('projects/list', {});
                set({ projects: res ?? [], loading: false });
            } catch (error) {
                console.error('Error fetching projects:', error);
                set({ loading: false });
            } finally {
                isFetchingProjects = false;
            }
        },

        buildTree: () => {
            const { customers, projectGroups, projects } = get();

            // Check if all data is loaded
            if (!Array.isArray(customers) || !Array.isArray(projectGroups) || !Array.isArray(projects)) {
                console.warn('Data not ready for building tree:', { customers, projectGroups, projects });
                set({ tree: [] });
                return [];
            }

            // Find unassigned projects
            const unassignedProjects = projects.filter((p) => !p.project_group);

            const tree: TreeNode[] = customers.map((customer) => ({
                key: `customer-${customer._id}`,
                title: customer.name,
                type: 'customer' as const,
                data: customer,
                children: projectGroups
                    .filter((g) => g.customer && customer._id && g.customer.toString() === customer._id.toString())
                    .map((group) => ({
                        key: `group-${group._id}`,
                        title: group.name,
                        type: 'group' as const,
                        data: group,
                        children: projects
                            .filter((p) => p.project_group && group._id && p.project_group.toString() === group._id.toString())
                            .map((project) => ({
                                key: `project-${project._id}`,
                                title: project.name,
                                type: 'project' as const,
                                data: project,
                            })),
                    })),
            }));

            // Add unassigned projects as a separate category at the beginning
            if (unassignedProjects.length > 0) {
                tree.unshift({
                    key: 'unassigned-projects',
                    title: 'Нераспределенные проекты',
                    type: 'unassigned-category' as const,
                    data: { name: 'Нераспределенные проекты', _id: 'unassigned' } as Customer,
                    children: unassignedProjects.map((project) => ({
                        key: `project-${project._id}`,
                        title: project.name,
                        type: 'project' as const,
                        data: project,
                    })),
                });
            }

            set({ tree });
            return tree;
        },

        createCustomer: async (name) => {
            try {
                const res = await api_request('customers/create', { name });
                await get().fetchCustomers();
                get().buildTree();
                return res;
            } catch (error) {
                console.error('Error creating customer:', error);
                throw error;
            }
        },

        updateCustomer: async (id, name) => {
            try {
                const res = await api_request('customers/update', { id, name });
                await get().fetchCustomers();
                get().buildTree();
                return res;
            } catch (error) {
                console.error('Error updating customer:', error);
                throw error;
            }
        },

        createProjectGroup: async (name, customer) => {
            try {
                const res = await api_request('project_groups/create', { name, customer });
                await get().fetchProjectGroups();
                get().buildTree();
                return res;
            } catch (error) {
                console.error('Error creating project group:', error);
                throw error;
            }
        },

        updateProjectGroup: async (id, name, customer) => {
            try {
                const res = await api_request('project_groups/update', { id, name, customer });
                await get().fetchProjectGroups();
                get().buildTree();
                return res;
            } catch (error) {
                console.error('Error updating project group:', error);
                throw error;
            }
        },

        moveProjectGroup: async (projectGroupNode, sourceCustomer, destCustomer) => {
            try {
                const res = await api_request('project_groups/move', {
                    project_group: projectGroupNode,
                    source_customer: sourceCustomer,
                    dest_customer: destCustomer,
                });
                await get().fetchProjectGroups();
                get().buildTree();
                return res;
            } catch (error) {
                console.error('Error moving project group:', error);
                throw error;
            }
        },

        moveProject: async (projectNode, sourceProjectGroup, destProjectGroup) => {
            try {
                const res = await api_request('projects/move', {
                    project: projectNode,
                    source_project_group: sourceProjectGroup,
                    dest_project_group: destProjectGroup,
                });
                await get().fetchProjects();
                get().buildTree();
                return res;
            } catch (error) {
                console.error('Error moving project:', error);
                throw error;
            }
        },

        createProject: async (projectData) => {
            try {
                const { project_group, ...project } = projectData;
                const res = await api_request('projects/create', {
                    project,
                    project_group,
                });
                await get().fetchProjects();
                get().buildTree();
                return res;
            } catch (error) {
                console.error('Error creating project:', error);
                throw error;
            }
        },

        updateProject: async (id, projectData) => {
            try {
                const project = { _id: id, ...projectData };
                const res = await api_request('projects/update', { project });
                await get().fetchProjects();
                get().buildTree();
                return res;
            } catch (error) {
                console.error('Error updating project:', error);
                throw error;
            }
        },
    };
});
