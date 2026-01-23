import { Button, Card, Form, Input, InputNumber, Modal, Table, Tooltip, Typography, message } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { type ReactElement, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import { employeeDirectory } from '../../services/employeeDirectory';

interface EmployeeRow {
  key: string;
  name: string;
  role: string;
  team: string;
}

interface SalaryRow {
  key: string;
  role: string;
  monthly: string;
  costRate: string;
}

interface EmployeeUnifiedRow {
  key: string;
  name: string;
  role: string;
  team: string;
  monthly: string;
  costRate: string;
}

type ChatRole = 'user' | 'agent';

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
}

const employeeData: EmployeeRow[] = employeeDirectory.map((employee) => ({
  key: employee.id,
  name: employee.name,
  role: employee.role,
  team: employee.team,
}));

const salaryData: SalaryRow[] = employeeDirectory.map((employee) => ({
  key: employee.id,
  role: employee.role,
  monthly: `${employee.monthlySalary} ₽`,
  costRate: `${employee.costRate} ₽/ч`,
}));

export default function EmployeesSalariesPage(): ReactElement {
  const [employees, setEmployees] = useState<EmployeeRow[]>(employeeData);
  const [salaries, setSalaries] = useState<SalaryRow[]>(salaryData);
  const [employeeModalOpen, setEmployeeModalOpen] = useState<boolean>(false);
  const [editingEmployeeKey, setEditingEmployeeKey] = useState<string | null>(null);
  const [employeeForm] = Form.useForm();
  const [chatInput, setChatInput] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'intro',
      role: 'agent',
      text: 'Опишите исполнителя текстом. Я заполню форму и задам вопросы, если данных не хватает.',
    },
  ]);
  const [draft, setDraft] = useState<Partial<Record<string, string | number>>>({});

  const unifiedRows = employees.map((employee): EmployeeUnifiedRow => {
    const salary = salaries.find((item) => item.role === employee.role);
    return {
      key: employee.key,
      name: employee.name,
      role: employee.role,
      team: employee.team,
      monthly: salary?.monthly ?? '—',
      costRate: salary?.costRate ?? '—',
    };
  });

  const handleSaveEmployee = async (): Promise<void> => {
    const values = await employeeForm.validateFields();
    if (editingEmployeeKey) {
      setEmployees((prev) =>
        prev.map((employee) =>
          employee.key === editingEmployeeKey
            ? { ...employee, name: values.name, role: values.role, team: values.team }
            : employee,
        ),
      );
      setSalaries((prev) =>
        prev.map((salary) =>
          salary.key === editingEmployeeKey
            ? {
                ...salary,
                role: values.role,
                monthly: `${values.monthly} ₽`,
                costRate: `${values.costRate} ₽/ч`,
              }
            : salary,
        ),
      );
      message.success('Исполнитель обновлён');
    } else {
      const key = `${Date.now()}-employee`;
      setEmployees((prev) => [
        ...prev,
        {
          key,
          name: values.name,
          role: values.role,
          team: values.team,
        },
      ]);
      setSalaries((prev) => [
        ...prev,
        {
          key,
          role: values.role,
          monthly: `${values.monthly} ₽`,
          costRate: `${values.costRate} ₽/ч`,
        },
      ]);
      message.success('Исполнитель добавлен');
    }
    employeeForm.resetFields();
    setDraft({});
    setEditingEmployeeKey(null);
    setEmployeeModalOpen(false);
  };

  const requiredFields = useMemo(
    () => [
      { key: 'name', label: 'имя' },
      { key: 'role', label: 'роль' },
      { key: 'team', label: 'команда' },
      { key: 'monthly', label: 'оклад' },
      { key: 'costRate', label: 'ставка (₽/ч)' },
    ],
    [],
  );

  const parseFromText = (text: string): Partial<Record<string, string | number>> => {
    const result: Partial<Record<string, string | number>> = {};
    const extract = (pattern: RegExp): string | null => {
      const match = text.match(pattern);
      return match ? match[1]?.trim() ?? null : null;
    };
    const name = extract(/имя\s*[:\-]?\s*([^,\n]+)/i);
    const role = extract(/роль\s*[:\-]?\s*([^,\n]+)/i);
    const team = extract(/команда\s*[:\-]?\s*([^,\n]+)/i);
    const monthly = extract(/(оклад|salary|зарплата)\s*[:\-]?\s*([\d\s]+)/i);
    const costRate = extract(/(cost\s*rate|ставка|р\/ч|руб\/ч|₽\/ч)\s*[:\-]?\s*([\d\s]+)/i);
    if (name) result.name = name;
    if (role) result.role = role;
    if (team) result.team = team;
    if (monthly) result.monthly = Number(monthly.replace(/\s+/g, ''));
    if (costRate) result.costRate = Number(costRate.replace(/\s+/g, ''));

    const chunks = text
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const numbers = text.match(/\d+/g)?.map((item) => Number(item)) ?? [];

    if (!result.name && chunks[0]) result.name = chunks[0];
    if (!result.role && chunks[1]) result.role = chunks[1];
    if (!result.team && chunks[2]) result.team = chunks[2];
    if (!result.monthly && numbers[0]) result.monthly = numbers[0];
    if (!result.costRate && numbers[1]) result.costRate = numbers[1];
    return result;
  };

  const pushMessage = (role: ChatRole, text: string): void => {
    setChatMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${role}`, role, text },
    ]);
  };

  const handleChatSubmit = (): void => {
    if (!chatInput.trim()) {
      return;
    }
    const userText = chatInput.trim();
    setChatInput('');
    pushMessage('user', userText);
    const extracted = parseFromText(userText);
    const nextDraft = { ...draft, ...extracted };
    setDraft(nextDraft);
    employeeForm.setFieldsValue(nextDraft);

    const missing = requiredFields.filter((field) => !nextDraft[field.key]);
    employeeForm.setFields(
      requiredFields.map((field) => ({
        name: field.key,
        errors: missing.some((item) => item.key === field.key) ? ['Нужно заполнить'] : [],
      })),
    );

    setEmployeeModalOpen(true);

    if (missing.length > 0) {
      pushMessage(
        'agent',
        `Не хватает данных: ${missing.map((item) => item.label).join(', ')}. Напишите их в ответ.`,
      );
      return;
    }
    pushMessage('agent', 'Заполнил форму. Проверьте и нажмите «Сохранить».');
  };

  const handleEditEmployee = (row: EmployeeUnifiedRow): void => {
    setEditingEmployeeKey(row.key);
    const monthlyValue = Number(String(row.monthly).replace(/[^\d]/g, '')) || 0;
    const costRateValue = Number(String(row.costRate).replace(/[^\d]/g, '')) || 0;
    employeeForm.setFieldsValue({
      name: row.name,
      role: row.role,
      team: row.team,
      monthly: monthlyValue,
      costRate: costRateValue,
    });
    setEmployeeModalOpen(true);
  };

  return (
    <div className="finops-page animate-fade-up">
      <Button type="link" className="!p-0 mb-2">
        <Link to="/directories">← Назад к справочникам</Link>
      </Button>
      <PageHeader
        title="Исполнители"
        description="База для расчёта себестоимости и маржи."
        actions={
          <Button type="primary" onClick={(): void => setEmployeeModalOpen(true)}>Добавить</Button>
        }
      />
      <Card className="mb-4">
        <div className="flex flex-col gap-3">
          <Typography.Text strong>Чат‑агент для добавления исполнителя</Typography.Text>
          <div className="flex flex-col gap-2">
            {chatMessages.map((message) => (
              <div
                key={message.id}
                className={`rounded-lg px-3 py-2 text-sm max-w-[80%] ${
                  message.role === 'user'
                    ? 'bg-blue-50 text-slate-900 self-end'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {message.text}
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2">
            <Input.TextArea
              value={chatInput}
              onChange={(event): void => setChatInput(event.target.value)}
              placeholder="Например: Иван П., Senior Dev, Platform, оклад 320000, cost rate 2000"
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
            <Button type="primary" onClick={handleChatSubmit}>
              Отправить
            </Button>
          </div>
        </div>
      </Card>
      <Table
        size="small"
        pagination={false}
        dataSource={unifiedRows}
        columns={[
          { title: 'Имя', dataIndex: 'name', key: 'name' },
          { title: 'Роль', dataIndex: 'role', key: 'role' },
          { title: 'Команда', dataIndex: 'team', key: 'team' },
          { title: 'Оклад', dataIndex: 'monthly', key: 'monthly' },
          { title: 'Cost rate', dataIndex: 'costRate', key: 'costRate' },
          {
            title: '',
            key: 'actions',
            width: 48,
            render: (_: unknown, row: EmployeeUnifiedRow): ReactElement => (
              <div className="flex items-start justify-end">
                <Tooltip title="Редактировать исполнителя">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    className="text-slate-400 hover:text-slate-900"
                    onClick={(): void => handleEditEmployee(row)}
                  />
                </Tooltip>
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={editingEmployeeKey ? 'Редактировать исполнителя' : 'Добавить исполнителя'}
        open={employeeModalOpen}
        onCancel={(): void => {
          employeeForm.resetFields();
          setEditingEmployeeKey(null);
          setEmployeeModalOpen(false);
        }}
        onOk={(): Promise<void> => handleSaveEmployee()}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={employeeForm} layout="vertical">
          <Form.Item name="name" label="Имя" rules={[{ required: true, message: 'Введите имя' }]}>
            <Input placeholder="Например, Иван П." />
          </Form.Item>
          <Form.Item name="role" label="Роль" rules={[{ required: true, message: 'Введите роль' }]}>
            <Input placeholder="Например, Senior Dev" />
          </Form.Item>
          <Form.Item name="team" label="Команда" rules={[{ required: true, message: 'Введите команду' }]}>
            <Input placeholder="Например, Platform" />
          </Form.Item>
          <Form.Item name="monthly" label="Оклад (₽)" rules={[{ required: true, message: 'Введите сумму' }]}>
            <InputNumber className="w-full" min={0} placeholder="320000" />
          </Form.Item>
          <Form.Item name="costRate" label="Cost rate (₽/ч)" rules={[{ required: true, message: 'Введите ставку' }]}>
            <InputNumber className="w-full" min={0} placeholder="2000" />
          </Form.Item>
        </Form>
      </Modal>

    </div>
  );
}
