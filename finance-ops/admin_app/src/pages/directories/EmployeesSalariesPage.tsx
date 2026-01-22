import { Button, Card, Form, Input, InputNumber, Modal, Table, Typography, message } from 'antd';
import { Link } from 'react-router-dom';
import { type ReactElement, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';

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

const employeeData: EmployeeRow[] = [
  { key: '1', name: 'Иван П.', role: 'Senior Dev', team: 'Platform' },
  { key: '2', name: 'Мария С.', role: 'PM', team: 'Delivery' },
];

const salaryData: SalaryRow[] = [
  { key: '1', role: 'Senior Dev', monthly: '320 000 ₽', costRate: '2 000 ₽/ч' },
  { key: '2', role: 'PM', monthly: '260 000 ₽', costRate: '1 600 ₽/ч' },
];

export default function EmployeesSalariesPage(): ReactElement {
  const [employees, setEmployees] = useState<EmployeeRow[]>(employeeData);
  const [salaries, setSalaries] = useState<SalaryRow[]>(salaryData);
  const [employeeModalOpen, setEmployeeModalOpen] = useState<boolean>(false);
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

  const handleAddEmployee = async (): Promise<void> => {
    const values = await employeeForm.validateFields();
    setEmployees((prev) => [
      ...prev,
      {
        key: `${Date.now()}-employee`,
        name: values.name,
        role: values.role,
        team: values.team,
      },
    ]);
    setSalaries((prev) => [
      ...prev,
      {
        key: `${Date.now()}-salary`,
        role: values.role,
        monthly: `${values.monthly} ₽`,
        costRate: `${values.costRate} ₽/ч`,
      },
    ]);
    message.success('Исполнитель добавлен');
    employeeForm.resetFields();
    setDraft({});
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
        ]}
      />

      <Modal
        title="Добавить исполнителя"
        open={employeeModalOpen}
        onCancel={(): void => {
          employeeForm.resetFields();
          setEmployeeModalOpen(false);
        }}
        onOk={(): Promise<void> => handleAddEmployee()}
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
