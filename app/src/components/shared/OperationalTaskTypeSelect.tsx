import { forwardRef } from 'react';
import { Select, type SelectProps } from 'antd';
import type { DefaultOptionType, RefSelectProps } from 'antd/es/select';

import { searchLabelFilterOption } from '../../utils/selectSearchFilter';
import {
  taskTypeSelectLabel,
  UNNAMED_TASK_TYPE_LABEL,
  type GroupedTaskTypeOption,
} from '../../utils/taskTypeSelectOptions';

type OperationalTaskTypeSelectProps = Omit<SelectProps<string, DefaultOptionType>, 'options' | 'value' | 'popupClassName'> & {
  options: GroupedTaskTypeOption[];
  value?: string | null;
  popupClassName?: never;
};

type OperationalTaskTypeOption = GroupedTaskTypeOption['options'][number];

const asOperationalTaskTypeOption = (value: unknown): OperationalTaskTypeOption | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as { value?: unknown };
  return typeof record.value === 'string' ? (value as OperationalTaskTypeOption) : null;
};

const joinPopupRootClassName = (...classNames: Array<string | undefined>): string =>
  classNames.filter(Boolean).join(' ');

const renderTaskTypeLabel = ({ label, value }: { label: unknown; value: unknown }): string => {
  const resolved = taskTypeSelectLabel(label, value);
  return resolved || UNNAMED_TASK_TYPE_LABEL;
};

const withCurrentTaskTypeValueOption = (
  options: GroupedTaskTypeOption[],
  value: string | null
): GroupedTaskTypeOption[] => {
  if (!value) return options;
  const hasValue = options.some((group) => group.options.some((option) => option.value === value));
  if (hasValue) return options;

  return [
    {
      label: 'Текущее значение',
      title: 'Текущее значение',
      options: [
        {
          label: UNNAMED_TASK_TYPE_LABEL,
          value,
          title: UNNAMED_TASK_TYPE_LABEL,
          searchLabel: UNNAMED_TASK_TYPE_LABEL,
        },
      ],
    },
    ...options,
  ];
};

const OperationalTaskTypeSelect = forwardRef<RefSelectProps, OperationalTaskTypeSelectProps>(
  function OperationalTaskTypeSelect(
    { options, classNames, placeholder = 'Тип задачи (операционный)', value = null, labelRender, ...rest },
    ref
  ) {
    const resolvedOptions = withCurrentTaskTypeValueOption(options, value);

    return (
      <Select
        ref={ref}
        allowClear
        showSearch
        placeholder={placeholder}
        optionLabelProp="label"
        optionFilterProp="searchLabel"
        filterOption={searchLabelFilterOption}
        labelRender={labelRender ?? renderTaskTypeLabel}
        optionRender={(option) => {
          const data = asOperationalTaskTypeOption(option.data);
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
              'copilot-task-type-select-popup',
              classNames?.popup?.root
            ),
          },
        }}
        options={resolvedOptions}
        value={value}
        {...rest}
      />
    );
  }
);

export default OperationalTaskTypeSelect;
