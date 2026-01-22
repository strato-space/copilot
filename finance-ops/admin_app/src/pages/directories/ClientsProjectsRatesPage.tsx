import { Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Table, Typography, message } from 'antd';
import { Link } from 'react-router-dom';
import { type ReactElement, useState } from 'react';
import PageHeader from '../../components/PageHeader';

interface ClientRow {
  key: string;
  name: string;
  contract: string;
}

interface ProjectRow {
  key: string;
  name: string;
  client: string;
  type: string;
}

interface RateRow {
  key: string;
  role: string;
  rate: string;
  currency: string;
}

const clientData: ClientRow[] = [
  { key: '1', name: 'Aurora Retail', contract: 'T&M' },
  { key: '2', name: 'Northwind Labs', contract: 'Fix' },
];

const projectData: ProjectRow[] = [
  { key: '1', name: 'Aurora Core', client: 'Aurora Retail', type: 'T&M' },
  { key: '2', name: 'Northwind ML', client: 'Northwind Labs', type: 'T&M' },
];

const rateData: RateRow[] = [
  { key: '1', role: 'Senior Dev', rate: '3 500', currency: 'RUB/ч' },
  { key: '2', role: 'Analyst', rate: '2 800', currency: 'RUB/ч' },
];

export default function ClientsProjectsRatesPage(): ReactElement {
  const [clients, setClients] = useState<ClientRow[]>(clientData);
  const [projects, setProjects] = useState<ProjectRow[]>(projectData);
  const [rates, setRates] = useState<RateRow[]>(rateData);
  const [clientModalOpen, setClientModalOpen] = useState<boolean>(false);
  const [projectModalOpen, setProjectModalOpen] = useState<boolean>(false);
  const [rateModalOpen, setRateModalOpen] = useState<boolean>(false);
  const [clientForm] = Form.useForm();
  const [projectForm] = Form.useForm();
  const [rateForm] = Form.useForm();

  const handleAddClient = async (): Promise<void> => {
    const values = await clientForm.validateFields();
    setClients((prev) => [
      ...prev,
      {
        key: `${Date.now()}-client`,
        name: values.name,
        contract: values.contract,
      },
    ]);
    message.success('Клиент добавлен');
    clientForm.resetFields();
    setClientModalOpen(false);
  };

  const handleAddProject = async (): Promise<void> => {
    const values = await projectForm.validateFields();
    setProjects((prev) => [
      ...prev,
      {
        key: `${Date.now()}-project`,
        name: values.name,
        client: values.client,
        type: values.type,
      },
    ]);
    message.success('Проект добавлен');
    projectForm.resetFields();
    setProjectModalOpen(false);
  };

  const handleAddRate = async (): Promise<void> => {
    const values = await rateForm.validateFields();
    setRates((prev) => [
      ...prev,
      {
        key: `${Date.now()}-rate`,
        role: values.role,
        rate: String(values.rate),
        currency: values.currency,
      },
    ]);
    message.success('Ставка добавлена');
    rateForm.resetFields();
    setRateModalOpen(false);
  };

  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="Клиенты, проекты и ставки"
        description="Базовые справочники для расчёта выручки и прогноза."
        actions={
          <Button type="link">
            <Link to="/directories">← Назад к справочникам</Link>
          </Button>
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card>
            <div className="flex items-center justify-between mb-4">
              <Typography.Text strong>Клиенты</Typography.Text>
              <Button size="small" type="primary" onClick={(): void => setClientModalOpen(true)}>Добавить</Button>
            </div>
            <Table
              size="small"
              pagination={false}
              dataSource={clients}
              columns={[
                { title: 'Клиент', dataIndex: 'name', key: 'name' },
                { title: 'Контракт', dataIndex: 'contract', key: 'contract' },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card>
            <div className="flex items-center justify-between mb-4">
              <Typography.Text strong>Проекты</Typography.Text>
              <Button size="small" type="primary" onClick={(): void => setProjectModalOpen(true)}>Добавить</Button>
            </div>
            <Table
              size="small"
              pagination={false}
              dataSource={projects}
              columns={[
                { title: 'Проект', dataIndex: 'name', key: 'name' },
                { title: 'Клиент', dataIndex: 'client', key: 'client' },
                { title: 'Тип', dataIndex: 'type', key: 'type' },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card>
            <div className="flex items-center justify-between mb-4">
              <Typography.Text strong>Ставки</Typography.Text>
              <Button size="small" type="primary" onClick={(): void => setRateModalOpen(true)}>Добавить</Button>
            </div>
            <Table
              size="small"
              pagination={false}
              dataSource={rates}
              columns={[
                { title: 'Роль', dataIndex: 'role', key: 'role' },
                { title: 'Ставка', dataIndex: 'rate', key: 'rate' },
                { title: 'Валюта', dataIndex: 'currency', key: 'currency' },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        title="Добавить клиента"
        open={clientModalOpen}
        onCancel={(): void => {
          clientForm.resetFields();
          setClientModalOpen(false);
        }}
        onOk={(): Promise<void> => handleAddClient()}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={clientForm} layout="vertical">
          <Form.Item name="name" label="Название клиента" rules={[{ required: true, message: 'Введите клиента' }]}>
            <Input placeholder="Например, Aurora Retail" />
          </Form.Item>
          <Form.Item name="contract" label="Тип контракта" rules={[{ required: true, message: 'Выберите тип' }]}>
            <Select
              options={[
                { label: 'T&M', value: 'T&M' },
                { label: 'Fix', value: 'Fix' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Добавить проект"
        open={projectModalOpen}
        onCancel={(): void => {
          projectForm.resetFields();
          setProjectModalOpen(false);
        }}
        onOk={(): Promise<void> => handleAddProject()}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={projectForm} layout="vertical">
          <Form.Item name="name" label="Название проекта" rules={[{ required: true, message: 'Введите проект' }]}>
            <Input placeholder="Например, Aurora Core" />
          </Form.Item>
          <Form.Item name="client" label="Клиент" rules={[{ required: true, message: 'Укажите клиента' }]}>
            <Input placeholder="Например, Aurora Retail" />
          </Form.Item>
          <Form.Item name="type" label="Тип контракта" rules={[{ required: true, message: 'Выберите тип' }]}>
            <Select
              options={[
                { label: 'T&M', value: 'T&M' },
                { label: 'Fix', value: 'Fix' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Добавить ставку"
        open={rateModalOpen}
        onCancel={(): void => {
          rateForm.resetFields();
          setRateModalOpen(false);
        }}
        onOk={(): Promise<void> => handleAddRate()}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={rateForm} layout="vertical">
          <Form.Item name="role" label="Роль" rules={[{ required: true, message: 'Введите роль' }]}>
            <Input placeholder="Например, Senior Dev" />
          </Form.Item>
          <Form.Item name="rate" label="Ставка" rules={[{ required: true, message: 'Введите ставку' }]}>
            <InputNumber className="w-full" min={0} placeholder="3500" />
          </Form.Item>
          <Form.Item name="currency" label="Валюта" rules={[{ required: true, message: 'Выберите валюту' }]}>
            <Select
              options={[
                { label: 'RUB/ч', value: 'RUB/ч' },
                { label: 'USD/ч', value: 'USD/ч' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
