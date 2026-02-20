import { Button, Card, Col, Form, Input, InputNumber, Row, Select, Typography, message } from 'antd';
import { type ReactElement, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import PageHeader from '../components/PageHeader';
import { apiClient } from '../services/api';
import { usePlanFactStore } from '../store/planFactStore';
import { type PlanFactProjectRow } from '../services/types';

export default function ProjectEditPage(): ReactElement {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const { data, fetchPlanFact } = usePlanFactStore();

  const projectContext = useMemo((): { customerName: string; project: PlanFactProjectRow } | null => {
    if (!data || !projectId) {
      return null;
    }
    for (const customer of data.customers) {
      const project = customer.projects.find((item) => item.project_id === projectId);
      if (project) {
        return { customerName: customer.customer_name, project };
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
      customerName: projectContext.customerName,
      projectName: projectContext.project.project_name ?? '',
      subprojectName: projectContext.project.subproject_name ?? '',
      contractType: projectContext.project.contract_type ?? 'T&M',
      rateRub: projectContext.project.rate_rub_per_hour ?? undefined,
    });
  }, [projectContext, form]);

  const handleSave = async (): Promise<void> => {
    if (!projectId) {
      message.error('Не удалось определить проект');
      return;
    }

    let values: Record<string, unknown>;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    try {
      const payload = {
        project_id: projectId,
        project_name: values.projectName,
        subproject_name: values.subprojectName,
        contract_type: values.contractType,
        rate_rub_per_hour: values.rateRub,
      };
      await apiClient.put('/plan-fact/project', payload);
      await fetchPlanFact();
      message.success('Изменения сохранены');
    } catch (error) {
      const messageText = isAxiosError(error)
        ? error.response?.data?.error?.message ?? error.message
        : 'Не удалось сохранить изменения';
      message.error(
        typeof messageText === 'string' ? messageText : 'Не удалось сохранить изменения',
      );
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
                <Form.Item label="Заказчик" name="customerName">
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
