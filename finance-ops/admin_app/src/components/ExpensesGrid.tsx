import {
  AutoComplete,
  Button,
  DatePicker,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  EllipsisOutlined,
  FilterOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  type CSSProperties,
  type ReactElement,
  type TdHTMLAttributes,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { formatCurrency, formatHours, formatMonthLabel } from '../utils/format';
import { type EmployeeDirectoryEntry } from '../services/employeeDirectory';
import { apiClient } from '../services/api';
import {
  convertToRub,
  expenseCategories as expenseCategoriesSeed,
  expenseOperationsSeed,
  fxRatesByMonth,
  type ExpenseCategory,
  type ExpenseCurrency,
  type ExpenseOperation,
} from '../services/expenseDirectory';
import { Link } from 'react-router-dom';

interface ExpenseMonthCell {
  amount: number;
  hours?: number;
  count?: number;
}

interface ExpenseRow {
  key: string;
  kind: 'salary' | 'other';
  typeLabel: string;
  name: string;
  role?: string;
  team?: string;
  employee_id?: string;
  category_id?: string;
  months: Record<string, ExpenseMonthCell>;
}

interface ExpenseFormValues {
  month: Dayjs;
  categoryId: string;
  amount: number;
  currency: ExpenseCurrency;
  fxManual?: number;
  vendor?: string;
  comment?: string;
  attachments?: UploadFile[];
}

export interface ExpensesGridHandle {
  openAddExpense: () => void;
}

interface Props {
  employees: EmployeeDirectoryEntry[];
  months: string[];
  focusMonth: string;
  onFocusMonthChange: (month: string) => void;
}

type SummaryCellProps = TdHTMLAttributes<HTMLTableCellElement> & {
  index: number;
  colSpan?: number;
  rowSpan?: number;
};

const SummaryCell = Table.Summary.Cell as unknown as (props: SummaryCellProps) => ReactElement;

const PIN_STORAGE_KEY = 'finopsPinnedExpenseMonths';
const TYPE_COL_WIDTH = 96;
const NAME_COL_WIDTH = 240;
const ACTION_COL_WIDTH = 32;
const MONTH_COL_WIDTH = 128;

const buildHours = (employeeIndex: number, monthIndex: number): number => {
  const base = 120 + employeeIndex * 6;
  const wave = (monthIndex % 4) * 6;
  return base + wave;
};

const buildRows = (
  employees: EmployeeDirectoryEntry[],
  categories: ExpenseCategory[],
  operations: ExpenseOperation[],
  months: string[],
): ExpenseRow[] => {
  const salaryRows: ExpenseRow[] = employees.map((employee, index) => {
    const monthCells: Record<string, ExpenseMonthCell> = {};
    months.forEach((month, monthIndex) => {
      monthCells[month] = {
        amount: employee.monthlySalary,
        hours: buildHours(index, monthIndex),
      };
    });
    return {
      key: `salary-${employee.id}`,
      kind: 'salary',
      typeLabel: 'З/П',
      employee_id: employee.id,
      name: employee.name,
      role: employee.role,
      team: employee.team,
      months: monthCells,
    };
  });

  const otherRows: ExpenseRow[] = categories
    .filter((category) => category.is_active || operations.some((op) => op.category_id === category.id))
    .map((category) => {
      const monthCells: Record<string, ExpenseMonthCell> = {};
    months.forEach((month) => {
      const monthOps = operations.filter(
        (operation) => operation.category_id === category.id && operation.month === month,
      );
      const amount = monthOps.reduce((sum, op) => sum + convertToRub(op, fxRatesByMonth[month] ?? 0), 0);
      monthCells[month] = { amount, count: monthOps.length };
    });
      return {
        key: `other-${category.id}`,
        kind: 'other',
        typeLabel: 'Другие',
        category_id: category.id,
        name: category.name,
        months: monthCells,
      };
    });

  return [...salaryRows, ...otherRows];
};

const buildTotals = (rows: ExpenseRow[], months: string[]): Record<string, ExpenseMonthCell> => {
  const totals: Record<string, ExpenseMonthCell> = {};
  months.forEach((month) => {
    totals[month] = { amount: 0, hours: 0 };
  });
  rows.forEach((row) => {
    months.forEach((month) => {
      const cell = row.months[month] ?? { amount: 0, hours: 0 };
      const current = totals[month] ?? { amount: 0, hours: 0 };
      totals[month] = {
        amount: current.amount + cell.amount,
        hours: (current.hours ?? 0) + (cell.hours ?? 0),
      };
    });
  });
  return totals;
};

const buildColumns = (
  months: string[],
  focusMonth: string,
  onFocusMonthChange: (month: string) => void,
  pinnedMonths: string[],
  onTogglePin: (month: string) => void,
  searchValue: string,
  onSearchChange: (value: string) => void,
  autoCompleteOptions: { label: string; options: { value: string }[] }[],
  onOpenCategoryMonth: (row: ExpenseRow, month: string) => void,
): ColumnsType<ExpenseRow> => {
  const pinnedSet = new Set(pinnedMonths);
  const orderedMonths = [
    ...months.filter((month) => pinnedSet.has(month)),
    ...months.filter((month) => !pinnedSet.has(month)),
  ];

  const baseColumns: ColumnsType<ExpenseRow> = [
    {
      title: 'Тип',
      dataIndex: 'typeLabel',
      key: 'type',
      width: TYPE_COL_WIDTH,
      fixed: 'left',
      render: (value: string, row: ExpenseRow): ReactElement => (
        <Tag color={row.kind === 'salary' ? 'blue' : 'gold'} className="text-xs">
          {value}
        </Tag>
      ),
    },
    {
      title: 'Вид',
      dataIndex: 'name',
      key: 'name',
      filteredValue: searchValue ? [searchValue] : null,
      filterIcon: (filtered: boolean): ReactElement => (
        <FilterOutlined className={filtered ? 'text-blue-600' : 'text-slate-400'} />
      ),
      filterDropdown: ({ confirm, clearFilters }): ReactElement => (
        <div className="ant-table-filter-dropdown" style={{ width: 320 }}>
          <div className="ant-table-filter-dropdown-search">
            <AutoComplete
              style={{ width: '100%' }}
              options={autoCompleteOptions}
              placeholder="Поиск"
              value={searchValue}
              onSearch={onSearchChange}
              onSelect={(value): void => {
                onSearchChange(value);
                confirm({ closeDropdown: true });
              }}
              allowClear
              onClear={(): void => {
                onSearchChange('');
                clearFilters?.();
              }}
            />
          </div>
          <div className="ant-table-filter-dropdown-btns">
            <Button
              size="small"
              onClick={(): void => {
                onSearchChange('');
                clearFilters?.();
                confirm({ closeDropdown: true });
              }}
            >
              Сброс
            </Button>
            <Button type="primary" size="small" onClick={(): void => confirm({ closeDropdown: true })}>
              ОК
            </Button>
          </div>
        </div>
      ),
      width: NAME_COL_WIDTH,
      fixed: 'left',
      render: (_: string, row: ExpenseRow): ReactElement => (
        <div>
          <div className="text-sm font-semibold text-slate-900">{row.name}</div>
          {row.kind === 'salary' ? (
            <div className="text-xs text-slate-500">{row.role} • {row.team}</div>
          ) : (
            <div className="text-xs text-slate-500">Прочие расходы</div>
          )}
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: ACTION_COL_WIDTH,
      fixed: 'left',
      className: 'finops-actions-col',
      onHeaderCell: (): { className: string } => ({ className: 'finops-actions-col' }),
      render: (_: unknown, row: ExpenseRow): ReactElement => {
        if (row.kind !== 'salary' || !row.employee_id) {
          return <span className="inline-block w-6" />;
        }
        return (
          <div className="flex items-start justify-end">
            <Tooltip title="Редактировать исполнителя">
              <Link
                to={`/directories/employees-salaries?employeeId=${row.employee_id}`}
                className="finops-row-action"
                aria-label="Редактировать исполнителя"
              >
                <Button
                  type="text"
                  size="small"
                  icon={<EllipsisOutlined />}
                  className="text-slate-400 hover:text-slate-900"
                />
              </Link>
            </Tooltip>
          </div>
        );
      },
    },
  ];

  const monthColumns = orderedMonths.map((month) => {
    const isPinned = pinnedSet.has(month);
    const isHighlighted = isPinned || month === focusMonth;
    const focusClass = isHighlighted ? 'finops-focus-left finops-focus-right' : '';
    const fixedProps = isPinned ? { fixed: 'left' as const } : {};
    return {
      title: (
        <div className={`finops-month-header ${isPinned ? 'is-pinned' : ''}`}>
          <button
            type="button"
            onClick={(): void => onFocusMonthChange(month)}
            className="finops-month-button finops-month-label text-slate-700 bg-transparent border-0 p-0 m-0 shadow-none rounded-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
          >
            <span className="font-semibold">{formatMonthLabel(month)}</span>
          </button>
          <button
            type="button"
            onClick={(): void => onTogglePin(month)}
            aria-label={isPinned ? 'Снять закрепление' : 'Закрепить месяц'}
            className="finops-pin-button"
          >
            {isPinned ? <PushpinFilled /> : <PushpinOutlined />}
          </button>
        </div>
      ),
      key: month,
      width: MONTH_COL_WIDTH,
      className: focusClass,
      onHeaderCell: (): { className: string } => ({ className: focusClass }),
      align: 'center' as const,
      ...fixedProps,
      onCell: (row: ExpenseRow): TdHTMLAttributes<HTMLTableCellElement> => ({
        onClick: (): void => {
          if (row.kind === 'other') {
            onOpenCategoryMonth(row, month);
          }
        },
        className: row.kind === 'other' ? 'cursor-pointer' : undefined,
      }),
      render: (_: unknown, row: ExpenseRow): ReactElement => {
        const cell = row.months[month] ?? { amount: 0, hours: 0 };
        const amountClass = cell.amount ? 'text-[10px] font-semibold text-slate-900' : 'text-[10px] font-semibold text-slate-400';
        const hoursValue = row.kind === 'salary' ? cell.hours ?? 0 : 0;
        const countValue = row.kind === 'other' ? cell.count ?? 0 : 0;
        return (
          <div className="finops-cell-text px-2">
            <div className={amountClass}>{cell.amount ? formatCurrency(cell.amount) : '—'}</div>
            <div className={row.kind === 'salary'
              ? (hoursValue ? 'text-[8px] text-slate-500' : 'text-[8px] text-slate-400')
              : (countValue ? 'text-[8px] text-slate-500' : 'text-[8px] text-slate-400')
            }>
              {row.kind === 'salary'
                ? (hoursValue ? formatHours(hoursValue) : '—')
                : (countValue ? `${countValue} оп.` : '—')}
            </div>
          </div>
        );
      },
    };
  });

  return [...baseColumns, ...monthColumns];
};

const ExpensesGrid = forwardRef<ExpensesGridHandle, Props>(({
  employees,
  months,
  focusMonth,
  onFocusMonthChange,
}, ref): ReactElement => {
  const [searchValue, setSearchValue] = useState<string>('');
  const [pinnedMonths, setPinnedMonths] = useState<string[]>(() => {
    if (typeof window === 'undefined') {
      return [focusMonth];
    }
    try {
      const raw = window.localStorage.getItem(PIN_STORAGE_KEY);
      if (!raw) {
        return [focusMonth];
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const sanitized = parsed.filter((value): value is string => typeof value === 'string');
        return sanitized.length > 0 ? sanitized : [focusMonth];
      }
    } catch {
      return [focusMonth];
    }
    return [focusMonth];
  });
  const [categories, setCategories] = useState<ExpenseCategory[]>(expenseCategoriesSeed);
  const [operations, setOperations] = useState<ExpenseOperation[]>(expenseOperationsSeed);
  const [expenseModalOpen, setExpenseModalOpen] = useState<boolean>(false);
  const [editingOperation, setEditingOperation] = useState<ExpenseOperation | null>(null);
  const [categoryInput, setCategoryInput] = useState<string>('');
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [drawerCategory, setDrawerCategory] = useState<ExpenseCategory | null>(null);
  const [drawerMonth, setDrawerMonth] = useState<string>('');
  const [form] = Form.useForm<ExpenseFormValues>();

  const rows = useMemo(
    (): ExpenseRow[] => buildRows(employees, categories, operations, months),
    [employees, categories, operations, months],
  );

  const autoCompleteOptions = useMemo(
    () => [
      {
        label: 'Исполнители',
        options: employees.map((employee) => ({ value: employee.name })),
      },
      {
        label: 'Виды затрат',
        options: categories.map((category) => ({ value: category.name })),
      },
    ],
    [employees, categories],
  );

  const filteredRows = useMemo((): ExpenseRow[] => {
    const query = searchValue.trim().toLowerCase();
    if (!query) {
      return rows;
    }
    return rows.filter((row) => row.name.toLowerCase().includes(query));
  }, [rows, searchValue]);

  const totalsByMonth = useMemo(
    (): Record<string, ExpenseMonthCell> => buildTotals(filteredRows, months),
    [filteredRows, months],
  );

  useEffect((): void => {
    setPinnedMonths((prev) => {
      let next = prev.filter((month) => months.includes(month));
      if (next.length === 0) {
        next = [focusMonth];
      }
      while (next.length > 3) {
        next.shift();
      }
      return next;
    });
  }, [focusMonth, months]);

  useEffect((): void => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pinnedMonths));
  }, [pinnedMonths]);

  const handleTogglePin = (month: string): void => {
    setPinnedMonths((prev) => {
      const isPinned = prev.includes(month);
      if (isPinned) {
        return prev.filter((item) => item !== month);
      }
      const next = [...prev, month];
      if (!next.includes(focusMonth)) {
        next.push(focusMonth);
      }
      while (next.length > 3) {
        next.shift();
      }
      return next;
    });
  };

  const handleAddCategory = (): void => {
    const trimmed = categoryInput.trim();
    if (!trimmed) {
      return;
    }
    const idBase = trimmed.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
    const newCategory: ExpenseCategory = {
      id: `${idBase}-${Date.now()}`,
      name: trimmed,
      is_active: true,
    };
    setCategories((prev) => [...prev, newCategory]);
    setCategoryInput('');
    form.setFieldValue('categoryId', newCategory.id);
  };

  const openExpenseModal = (categoryId?: string, month?: string, operation?: ExpenseOperation): void => {
    setEditingOperation(operation ?? null);
    form.resetFields();
    const monthValue = month ? dayjs(`${month}-01`) : dayjs(`${focusMonth}-01`);
    const initialValues: Partial<ExpenseFormValues> = {
      month: monthValue,
      currency: operation?.currency ?? 'RUB',
    };
    if (categoryId) {
      initialValues.categoryId = categoryId;
    }
    if (typeof operation?.amount === 'number') {
      initialValues.amount = operation.amount;
    }
    if (typeof operation?.fx_used === 'number') {
      initialValues.fxManual = operation.fx_used;
    }
    if (operation?.vendor) {
      initialValues.vendor = operation.vendor;
    }
    if (operation?.comment) {
      initialValues.comment = operation.comment;
    }
    if (operation?.attachments?.length) {
      initialValues.attachments = operation.attachments.map((name, index) => ({
        uid: `${operation.id}-${index}`,
        name,
        status: 'done',
      }));
    }
    form.setFieldsValue(initialValues);
    setExpenseModalOpen(true);
  };

  useImperativeHandle(ref, () => ({
    openAddExpense: (): void => {
      openExpenseModal();
    },
  }));

  const handleSaveExpense = async (): Promise<void> => {
    try {
      const values = await form.validateFields();
      const month = values.month.format('YYYY-MM');
      const fxAuto = fxRatesByMonth[month];
      const fxUsed = values.currency === 'USD' ? (fxAuto ?? values.fxManual ?? 0) : undefined;
      const baseOperation: ExpenseOperation = {
        id: editingOperation?.id ?? `op-${Date.now()}`,
        category_id: values.categoryId,
        month,
        amount: values.amount,
        currency: values.currency,
      };
      const operationWithOptional: ExpenseOperation = {
        ...baseOperation,
        ...(typeof fxUsed === 'number' ? { fx_used: fxUsed } : {}),
        ...(values.vendor ? { vendor: values.vendor } : {}),
        ...(values.comment ? { comment: values.comment } : {}),
        ...(values.attachments?.length
          ? { attachments: values.attachments.map((file) => (file.response as { name?: string })?.name ?? file.name) }
          : {}),
      };

      if (editingOperation) {
        setOperations((prev) => prev.map((item) => (item.id === editingOperation.id ? operationWithOptional : item)));
        message.success('Расход обновлён');
      } else {
        setOperations((prev) => [...prev, operationWithOptional]);
        message.success('Расход добавлен');
      }
      setExpenseModalOpen(false);
      setEditingOperation(null);
      form.resetFields();
    } catch {
      // validation errors
    }
  };

  const handleDeleteOperation = (operationId: string): void => {
    setOperations((prev) => prev.filter((item) => item.id !== operationId));
    message.success('Операция удалена');
  };

  const handleUpload: UploadProps['customRequest'] = async (options) => {
    const { file, onSuccess, onError } = options;
    try {
      const formData = new FormData();
      formData.append('file', file as Blob);
      const response = await apiClient.post('/uploads/expense-attachments', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onSuccess?.(response.data);
      message.success('Файл загружен');
    } catch (error) {
      onError?.(error as Error);
      message.error('Не удалось загрузить файл');
    }
  };

  const handleOpenCategoryMonth = (row: ExpenseRow, month: string): void => {
    if (row.kind !== 'other' || !row.category_id) {
      return;
    }
    const category = categories.find((item) => item.id === row.category_id) ?? null;
    setDrawerCategory(category);
    setDrawerMonth(month);
    setDrawerOpen(true);
  };

  if (rows.length === 0) {
    return <Typography.Text type="secondary">Нет данных для отображения.</Typography.Text>;
  }

  const baseFixedWidth = TYPE_COL_WIDTH + NAME_COL_WIDTH + ACTION_COL_WIDTH;
  const scrollX = baseFixedWidth + months.length * MONTH_COL_WIDTH;
  const summaryLabelColSpan = 3;

  const drawerOperations = operations.filter(
    (operation) => operation.category_id === drawerCategory?.id && operation.month === drawerMonth,
  );

  const drawerColumns: ColumnsType<ExpenseOperation> = [
    {
      title: 'Сумма',
      dataIndex: 'amount',
      key: 'amount',
      render: (value: number, row): ReactElement => (
        <span>{row.currency === 'USD' ? `${value} $` : formatCurrency(value)}</span>
      ),
    },
    {
      title: 'Валюта',
      dataIndex: 'currency',
      key: 'currency',
    },
    {
      title: 'FX',
      dataIndex: 'fx_used',
      key: 'fx_used',
      render: (value?: number): ReactElement => <span>{value ? value.toFixed(2) : '—'}</span>,
    },
    {
      title: 'Поставщик',
      dataIndex: 'vendor',
      key: 'vendor',
      render: (value?: string): ReactElement => <span>{value ?? '—'}</span>,
    },
    {
      title: '',
      key: 'actions',
      render: (_: unknown, operation): ReactElement => (
        <Space size={8}>
          <Button size="small" type="link" onClick={(): void => openExpenseModal(operation.category_id, operation.month, operation)}>
            Редактировать
          </Button>
          <Button size="small" type="link" danger onClick={(): void => handleDeleteOperation(operation.id)}>
            Удалить
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Table
        size="small"
        pagination={false}
        dataSource={filteredRows}
        columns={buildColumns(
          months,
          focusMonth,
          onFocusMonthChange,
          pinnedMonths,
          handleTogglePin,
          searchValue,
          setSearchValue,
          autoCompleteOptions,
          handleOpenCategoryMonth,
        )}
        rowClassName={(): string => 'finops-row-project'}
        scroll={{ x: scrollX }}
        sticky
        tableLayout="fixed"
        className="finops-table"
        summary={(): ReactElement => {
          let cellIndex = summaryLabelColSpan;
          const pinnedSet = new Set(pinnedMonths);
          const summaryMonths = [
            ...months.filter((month) => pinnedSet.has(month)),
            ...months.filter((month) => !pinnedSet.has(month)),
          ];
          const pinnedOrdered = summaryMonths.filter((month) => pinnedSet.has(month));
          const pinnedIndexMap = new Map(pinnedOrdered.map((month, index) => [month, index]));
          const baseLeft = baseFixedWidth;

          return (
            <Table.Summary fixed="bottom">
              <Table.Summary.Row className="finops-summary-row">
                <SummaryCell
                  index={0}
                  colSpan={summaryLabelColSpan}
                  className="finops-summary-fixed"
                  style={{ left: 0, zIndex: 6, background: '#ffffff' }}
                >
                  <Typography.Text strong>ИТОГО</Typography.Text>
                </SummaryCell>
                {summaryMonths.map((month) => {
                  const cell = totalsByMonth[month] ?? { amount: 0, hours: 0 };
                  const isPinned = pinnedSet.has(month);
                  const isHighlighted = isPinned || month === focusMonth;
                  const focusClass = isHighlighted ? 'finops-focus-left finops-focus-right' : '';
                  const pinnedIndex = pinnedIndexMap.get(month);
                  const monthLeft =
                    typeof pinnedIndex === 'number' ? baseLeft + pinnedIndex * MONTH_COL_WIDTH : null;
                  const cellStyle =
                    isPinned && monthLeft !== null
                      ? ({ left: `${monthLeft}px`, zIndex: 5, background: '#ffffff' } as CSSProperties)
                      : undefined;
                  return (
                    <SummaryCell
                      key={`${month}-total`}
                      index={cellIndex++}
                      className={`${isPinned ? 'finops-summary-fixed' : ''} finops-value-col ${focusClass}`.trim()}
                      style={cellStyle}
                    >
                      <div className="finops-cell-text">
                        <div className={cell.amount ? 'text-xs font-semibold text-slate-900' : 'text-xs font-semibold text-slate-400'}>
                          {cell.amount ? formatCurrency(cell.amount) : '—'}
                        </div>
                        <div className={cell.hours ? 'text-[10px] text-slate-500' : 'text-[10px] text-slate-400'}>
                          {cell.hours ? formatHours(cell.hours) : '—'}
                        </div>
                      </div>
                    </SummaryCell>
                  );
                })}
              </Table.Summary.Row>
            </Table.Summary>
          );
        }}
      />

      <Drawer
        open={drawerOpen}
        onClose={(): void => setDrawerOpen(false)}
        title={
          drawerCategory
            ? `Операции: ${drawerCategory.name} • ${formatMonthLabel(drawerMonth)}`
            : 'Операции'
        }
        width={520}
        extra={
          <Button type="primary" onClick={(): void => openExpenseModal(drawerCategory?.id, drawerMonth)}>
            Добавить
          </Button>
        }
      >
        {drawerOperations.length === 0 ? (
          <Typography.Text type="secondary">Операций нет.</Typography.Text>
        ) : (
          <Table
            size="small"
            pagination={false}
            dataSource={drawerOperations}
            columns={drawerColumns}
            rowKey="id"
          />
        )}
      </Drawer>

      <Modal
        open={expenseModalOpen}
        onCancel={(): void => setExpenseModalOpen(false)}
        onOk={handleSaveExpense}
        title={editingOperation ? 'Редактировать расход' : 'Добавить расход'}
        okText={editingOperation ? 'Сохранить' : 'Добавить'}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="Месяц"
            name="month"
            rules={[{ required: true, message: 'Выберите месяц' }]}
          >
            <DatePicker picker="month" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="Вид затрат"
            name="categoryId"
            rules={[{ required: true, message: 'Выберите категорию' }]}
          >
            <Select
              showSearch
              placeholder="Выберите категорию"
              options={categories.map((category) => ({
                label: category.name,
                value: category.id,
              }))}
              dropdownRender={(menu): ReactElement => (
                <div>
                  {menu}
                  <Divider style={{ margin: '8px 0' }} />
                  <Space style={{ padding: '0 8px 4px' }}>
                    <Input
                      placeholder="Новая категория"
                      value={categoryInput}
                      onChange={(event): void => setCategoryInput(event.target.value)}
                    />
                    <Button type="link" onClick={handleAddCategory}>
                      Добавить
                    </Button>
                  </Space>
                </div>
              )}
            />
          </Form.Item>
          <Form.Item
            label="Сумма"
            name="amount"
            rules={[{ required: true, message: 'Укажите сумму' }]}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="Валюта"
            name="currency"
            rules={[{ required: true, message: 'Выберите валюту' }]}
            initialValue="RUB"
          >
            <Select
              options={[
                { label: 'RUB', value: 'RUB' },
                { label: 'USD', value: 'USD' },
              ]}
            />
          </Form.Item>
          <Form.Item shouldUpdate={(prev, next) => prev.currency !== next.currency || prev.month !== next.month}>
            {({ getFieldValue }): ReactElement | null => {
              const currency = getFieldValue('currency') as ExpenseCurrency | undefined;
              const monthValue = getFieldValue('month') as Dayjs | undefined;
              if (currency !== 'USD') {
                return null;
              }
              const monthKey = monthValue ? monthValue.format('YYYY-MM') : '';
              const fxAuto = fxRatesByMonth[monthKey];
              return (
                <Form.Item
                  label={fxAuto ? `FX (авто: ${fxAuto.toFixed(2)})` : 'FX вручную'}
                  name="fxManual"
                  rules={
                    fxAuto
                      ? []
                      : [{ required: true, message: 'Укажите FX вручную' }]
                  }
                >
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item
            label="Поставщик/сервис"
            name="vendor"
          >
            <Input />
          </Form.Item>
          <Form.Item shouldUpdate={(prev, next) => prev.currency !== next.currency || prev.month !== next.month}>
            {({ getFieldValue }): ReactElement => {
              const currency = getFieldValue('currency') as ExpenseCurrency | undefined;
              const monthValue = getFieldValue('month') as Dayjs | undefined;
              const monthKey = monthValue ? monthValue.format('YYYY-MM') : '';
              const fxAuto = fxRatesByMonth[monthKey];
              const requiresComment = currency === 'USD' && !fxAuto;
              return (
                <Form.Item
                  label="Комментарий"
                  name="comment"
                  rules={requiresComment ? [{ required: true, message: 'Комментарий обязателен при ручном FX' }] : []}
                >
                  <Input.TextArea rows={3} />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item label="Вложения" name="attachments" valuePropName="fileList">
            <Upload multiple customRequest={handleUpload}>
              <Button icon={<PlusOutlined />}>Загрузить</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
});

export default ExpensesGrid;
