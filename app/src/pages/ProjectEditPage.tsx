import { Button, Card, Col, Form, Input, InputNumber, Row, Select, Typography, message } from 'antd';
import { type ReactElement, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { usePlanFactStore } from '../store/planFactStore';
import { type PlanFactProjectRow } from '../services/types';

export default function ProjectEditPage(): ReactElement {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const { data, fetchPlanFact } = usePlanFactStore();

  const projectContext = useMemo((): { clientName: string; project: PlanFactProjectRow } | null => {
    if (!data || !projectId) {
      return null;
    }
    for (const client of data.clients) {
      const project = client.projects.find((item) => item.project_id === projectId);
      if (project) {
        return { clientName: client.client_name, project };
      }
    }
    return null;
  }, [data, projectId]);

  useEffect((): void => {
    void fetchPlanFact();
  }, [fetchPlanFact]);

  useEffect((): void => {
    if (!projectContext) {
      form.resetFields();
      return;
    }
    form.setFieldsValue({
      clientName: projectContext.clientName,
      projectName: projectContext.project.project_name ?? '',
      subprojectName: projectContext.project.subproject_name ?? '',
      contractType: projectContext.project.contract_type ?? 'T&M',
      rateRub: projectContext.project.rate_rub_per_hour ?? undefined,
    });
  }, [projectContext, form]);

  const handleSave = async (): Promise<void> => {
    try {
      await form.validateFields();
      message.success('Изменения сохранены локально');
    } catch {
      // validation handled by Ant Design
    }
  };

  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="Проект"
        description="Редактирование параметров проекта."
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={(): void => void navigate('/guide/clients-projects-rates')}>Назад</Button>
            <Button type="primary" onClick={(): void => void handleSave()}>
              Сохранить
            </Button>
          </div>
        }
      />
      <Card>
        {projectContext ? (
          <Form form={form} layout="vertical">
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Form.Item label="Клиент" name="clientName">
                  <Input disabled />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  label="Проект"
                  name="projectName"
                  rules={[{ required: true, message: 'Введите название проекта' }]}
                >
                  <Input placeholder="Название проекта" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item label="Подпроект" name="subprojectName">
                  <Input placeholder="Например, Support" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item label="Тип контракта" name="contractType">
                  <Select
                    options={[
                      { value: 'T&M', label: 'T&M' },
                      { value: 'Fix', label: 'Fix' },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item label="Ставка, ₽/ч" name="rateRub">
                  <InputNumber className="w-full" min={0} placeholder="Например, 1500" />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        ) : (
          <Typography.Text type="secondary">
            Проект не найден. Проверьте ссылку или обновите данные.
          </Typography.Text>
        )}
      </Card>
    </div>
  );
}
