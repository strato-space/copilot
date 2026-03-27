import { forwardRef } from 'react';
import { Select, type SelectProps } from 'antd';
import type { DefaultOptionType, RefSelectProps } from 'antd/es/select';

import { searchLabelFilterOption } from '../../utils/selectSearchFilter';
import {
  projectSelectLabel,
  UNNAMED_PROJECT_LABEL,
  type GroupedSelectOption,
} from '../../utils/projectSelectOptions';

type ProjectSelectProps = Omit<SelectProps<string, DefaultOptionType>, 'options' | 'value' | 'popupClassName'> & {
  options: GroupedSelectOption[];
  value?: string | null;
  popupClassName?: never;
};

type ProjectSelectOption = GroupedSelectOption['options'][number];

const asProjectSelectOption = (value: unknown): ProjectSelectOption | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as { value?: unknown };
  return typeof record.value === 'string' ? (value as ProjectSelectOption) : null;
};

const joinPopupRootClassName = (...classNames: Array<string | undefined>): string =>
  classNames.filter(Boolean).join(' ');

const renderProjectLabel = ({ label, value }: { label: unknown; value: unknown }): string => {
  const resolved = projectSelectLabel(label, value);
  return resolved || UNNAMED_PROJECT_LABEL;
};

const withCurrentProjectValueOption = (
  options: GroupedSelectOption[],
  value: string | null
): GroupedSelectOption[] => {
  if (!value) return options;
  const hasValue = options.some((group) => group.options.some((option) => option.value === value));
  if (hasValue) return options;

  return [
    {
      label: 'Текущее значение',
      title: 'Текущее значение',
      options: [
        {
          label: UNNAMED_PROJECT_LABEL,
          value,
          title: UNNAMED_PROJECT_LABEL,
          searchLabel: UNNAMED_PROJECT_LABEL,
        },
      ],
    },
    ...options,
  ];
};

const ProjectSelect = forwardRef<RefSelectProps, ProjectSelectProps>(function ProjectSelect(
  { options, classNames, value = null, labelRender, ...rest },
  ref
) {
  const resolvedOptions = withCurrentProjectValueOption(options, value);

  return (
    <Select
      ref={ref}
      showSearch
      optionLabelProp="label"
      optionFilterProp="searchLabel"
      filterOption={searchLabelFilterOption}
      labelRender={labelRender ?? renderProjectLabel}
      optionRender={(option) => {
        const data = asProjectSelectOption(option.data);
        if (!data) return <span>{String(option.label ?? '')}</span>;
        const hierarchyLabel = typeof data.hierarchyLabel === 'string' ? data.hierarchyLabel.trim() : '';
        return (
          <div className="flex min-w-0 flex-col py-0.5">
            <span className="truncate text-[13px] leading-5 text-slate-900">{data.label}</span>
            {hierarchyLabel ? (
              <span className="truncate text-[11px] leading-4 text-slate-500">{hierarchyLabel}</span>
            ) : null}
          </div>
        );
      }}
      listItemHeight={44}
      popupMatchSelectWidth={false}
      classNames={{
        ...classNames,
        popup: {
          ...classNames?.popup,
          root: joinPopupRootClassName(
            'copilot-hierarchical-select-popup',
            'copilot-project-select-popup',
            classNames?.popup?.root
          ),
        },
      }}
      options={resolvedOptions}
      value={value}
      {...rest}
    />
  );
});

export default ProjectSelect;
