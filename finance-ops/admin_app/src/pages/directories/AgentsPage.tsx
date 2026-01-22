import { Button, Card, Form, Input, List, Modal, Select, Tag, Typography, message } from 'antd';
import { Link } from 'react-router-dom';
import { type ReactElement, useState } from 'react';
import PageHeader from '../../components/PageHeader';

interface AgentItem {
  title: string;
  description: string;
  status: 'active' | 'draft';
}

const agentsData: AgentItem[] = [
  {
    title: 'K2 Финансы',
    description: 'Помогает с запросами по план‑факт и прогнозу.',
    status: 'active',
  },
  {
    title: 'K2 Аудит',
    description: 'Проверяет корректность изменений и фиксацию месяца.',
    status: 'draft',
  },
];

const statusColor: Record<AgentItem['status'], string> = {
  active: 'green',
  draft: 'orange',
};

export default function AgentsPage(): ReactElement {
  const [agents, setAgents] = useState<AgentItem[]>(agentsData);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [form] = Form.useForm();

  const handleAddAgent = async (): Promise<void> => {
    const values = await form.validateFields();
    setAgents((prev) => [
      ...prev,
      {
        title: values.title,
        description: values.description,
        status: values.status,
      },
    ]);
    message.success('Агент создан');
    form.resetFields();
    setModalOpen(false);
  };

  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="Агенты"
        description="Настройка автоматизированных действий и сценариев."
        actions={
          <Button type="link">
            <Link to="/directories">← Назад к справочникам</Link>
          </Button>
        }
      />
      <Card>
        <div className="flex items-center justify-between mb-4">
          <Typography.Text strong>Сценарии</Typography.Text>
          <Button size="small" type="primary" onClick={(): void => setModalOpen(true)}>Создать агента</Button>
        </div>
        <List
          dataSource={agents}
          renderItem={(item: AgentItem): ReactElement => (
            <List.Item>
              <List.Item.Meta
                title={
                  <div className="flex items-center gap-2">
                    <Tag color={statusColor[item.status]}>{item.status === 'active' ? 'Активен' : 'Черновик'}</Tag>
                    <span className="font-medium text-slate-900">{item.title}</span>
                  </div>
                }
                description={item.description}
              />
            </List.Item>
          )}
        />
      </Card>

      <Modal
        title="Создать агента"
        open={modalOpen}
        onCancel={(): void => {
          form.resetFields();
          setModalOpen(false);
        }}
        onOk={(): Promise<void> => handleAddAgent()}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="Название" rules={[{ required: true, message: 'Введите название' }]}>
            <Input placeholder="Например, K2 Финансы" />
          </Form.Item>
          <Form.Item name="description" label="Описание" rules={[{ required: true, message: 'Введите описание' }]}>
            <Input.TextArea rows={3} placeholder="Что делает агент" />
          </Form.Item>
          <Form.Item name="status" label="Статус" rules={[{ required: true, message: 'Выберите статус' }]}>
            <Select
              options={[
                { label: 'Активен', value: 'active' },
                { label: 'Черновик', value: 'draft' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
