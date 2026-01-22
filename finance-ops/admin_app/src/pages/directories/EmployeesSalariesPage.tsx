import { Button, Card, Col, Form, Input, InputNumber, Modal, Row, Table, Typography, message } from 'antd';
import { Link } from 'react-router-dom';
import { type ReactElement, useState } from 'react';
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
  const [salaryModalOpen, setSalaryModalOpen] = useState<boolean>(false);
  const [employeeForm] = Form.useForm();
  const [salaryForm] = Form.useForm();

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
    message.success('Исполнитель добавлен');
    employeeForm.resetFields();
    setEmployeeModalOpen(false);
  };

  const handleAddSalary = async (): Promise<void> => {
    const values = await salaryForm.validateFields();
    setSalaries((prev) => [
      ...prev,
      {
        key: `${Date.now()}-salary`,
        role: values.role,
        monthly: `${values.monthly} ₽`,
        costRate: `${values.costRate} ₽/ч`,
      },
    ]);
    message.success('Зарплата добавлена');
    salaryForm.resetFields();
    setSalaryModalOpen(false);
  };

  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="Исполнители и зарплаты"
        description="База для расчёта себестоимости и маржи."
        actions={
          <Button type="link">
            <Link to="/directories">← Назад к справочникам</Link>
          </Button>
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card>
            <div className="flex items-center justify-between mb-4">
              <Typography.Text strong>Исполнители</Typography.Text>
              <Button size="small" type="primary" onClick={(): void => setEmployeeModalOpen(true)}>Добавить</Button>
            </div>
            <Table
              size="small"
              pagination={false}
              dataSource={employees}
              columns={[
                { title: 'Имя', dataIndex: 'name', key: 'name' },
                { title: 'Роль', dataIndex: 'role', key: 'role' },
                { title: 'Команда', dataIndex: 'team', key: 'team' },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card>
            <div className="flex items-center justify-between mb-4">
              <Typography.Text strong>Зарплаты</Typography.Text>
              <Button size="small" type="primary" onClick={(): void => setSalaryModalOpen(true)}>Добавить</Button>
            </div>
            <Table
              size="small"
              pagination={false}
              dataSource={salaries}
              columns={[
                { title: 'Роль', dataIndex: 'role', key: 'role' },
                { title: 'Оклад', dataIndex: 'monthly', key: 'monthly' },
                { title: 'Cost rate', dataIndex: 'costRate', key: 'costRate' },
              ]}
            />
          </Card>
        </Col>
      </Row>

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
        </Form>
      </Modal>

      <Modal
        title="Добавить зарплату"
        open={salaryModalOpen}
        onCancel={(): void => {
          salaryForm.resetFields();
          setSalaryModalOpen(false);
        }}
        onOk={(): Promise<void> => handleAddSalary()}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={salaryForm} layout="vertical">
          <Form.Item name="role" label="Роль" rules={[{ required: true, message: 'Введите роль' }]}>
            <Input placeholder="Например, Senior Dev" />
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
