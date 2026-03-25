import fs from 'node:fs';
import path from 'node:path';

describe('Shared selector reuse contract', () => {
  const files = {
    meetingCard: fs.readFileSync(path.resolve(process.cwd(), 'src/components/voice/MeetingCard.tsx'), 'utf8'),
    sessionsList: fs.readFileSync(path.resolve(process.cwd(), 'src/pages/voice/SessionsListPage.tsx'), 'utf8'),
    addParticipantModal: fs.readFileSync(path.resolve(process.cwd(), 'src/components/voice/AddParticipantModal.tsx'), 'utf8'),
    possibleTasks: fs.readFileSync(path.resolve(process.cwd(), 'src/components/voice/PossibleTasks.tsx'), 'utf8'),
    createEpic: fs.readFileSync(path.resolve(process.cwd(), 'src/components/crm/CRMCreateEpic.tsx'), 'utf8'),
    createTicket: fs.readFileSync(path.resolve(process.cwd(), 'src/components/crm/CRMCreateTicket.tsx'), 'utf8'),
    kanban: fs.readFileSync(path.resolve(process.cwd(), 'src/components/crm/CRMKanban.tsx'), 'utf8'),
  };

  it('reuses the hydrated shared project selector path across voice and operops forms', () => {
    expect(files.meetingCard).toContain("import ProjectSelect from '../shared/ProjectSelect';");
    expect(files.sessionsList).toContain("import ProjectSelect from '../../components/shared/ProjectSelect';");
    expect(files.addParticipantModal).toContain("import ProjectSelect from '../shared/ProjectSelect';");
    expect(files.possibleTasks).toContain("import ProjectSelect from '../shared/ProjectSelect';");
    expect(files.createEpic).toContain("import ProjectSelect from '../shared/ProjectSelect';");
    expect(files.createTicket).toContain("import ProjectSelect from '../shared/ProjectSelect';");
    expect(files.kanban).toContain("import ProjectSelect from '../shared/ProjectSelect';");
    expect(files.meetingCard).toContain("import { useHydratedProjectOptions } from '../../hooks/useHydratedProjectOptions';");
    expect(files.possibleTasks).toContain("import { useHydratedProjectOptions } from '../../hooks/useHydratedProjectOptions';");
  });

  it('uses the shared operational task type options builder in operops ticket forms', () => {
    expect(files.possibleTasks).toContain("import OperationalTaskTypeSelect from '../shared/OperationalTaskTypeSelect';");
    expect(files.createTicket).toContain("import OperationalTaskTypeSelect from '../shared/OperationalTaskTypeSelect';");
    expect(files.kanban).toContain("import OperationalTaskTypeSelect from '../shared/OperationalTaskTypeSelect';");
    expect(files.createTicket).toContain("buildGroupedTaskTypeOptions");
    expect(files.createTicket).toContain("resolveTaskTypeSelectValue");
    expect(files.kanban).toContain("buildGroupedTaskTypeOptions");
    expect(files.kanban).toContain("resolveTaskTypeSelectValue");
    expect(files.createTicket).toContain('popupClassName="w-[380px]"');
  });

  it('standardizes selector search through the shared select wrappers', () => {
    const projectSelect = fs.readFileSync(path.resolve(process.cwd(), 'src/components/shared/ProjectSelect.tsx'), 'utf8');
    const taskTypeSelect = fs.readFileSync(path.resolve(process.cwd(), 'src/components/shared/OperationalTaskTypeSelect.tsx'), 'utf8');

    expect(projectSelect).toContain("import { searchLabelFilterOption } from '../../utils/selectSearchFilter';");
    expect(projectSelect).toContain('optionLabelProp="label"');
    expect(projectSelect).toContain('optionFilterProp="searchLabel"');
    expect(projectSelect).toContain('filterOption={searchLabelFilterOption}');
    expect(projectSelect).toContain('labelRender={labelRender ?? renderProjectLabel}');
    expect(projectSelect).toContain("'copilot-project-select-popup'");
    expect(projectSelect).toContain("popupClassName={joinPopupClassName(popupClassName)}");

    expect(taskTypeSelect).toContain("import { searchLabelFilterOption } from '../../utils/selectSearchFilter';");
    expect(taskTypeSelect).toContain('optionLabelProp="label"');
    expect(taskTypeSelect).toContain('optionFilterProp="searchLabel"');
    expect(taskTypeSelect).toContain('filterOption={searchLabelFilterOption}');
    expect(taskTypeSelect).toContain('labelRender={labelRender ?? renderTaskTypeLabel}');
    expect(taskTypeSelect).toContain("'copilot-task-type-select-popup'");
    expect(taskTypeSelect).toContain("popupClassName={joinPopupClassName(popupClassName)}");
  });
});
