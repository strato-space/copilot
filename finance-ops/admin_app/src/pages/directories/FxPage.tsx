import { Button, Card, DatePicker, Form, Input, InputNumber, Modal, Table, Typography, message } from 'antd';
import { Link } from 'react-router-dom';
import { type ReactElement, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import { useFxStore } from '../../store/fxStore';

interface FxRow {
  key: string;
  month: string;
  rate: string;
  source: string;
}

export default function FxPage(): ReactElement {
  const fxRates = useFxStore((state) => state.rates);
  const setRate = useFxStore((state) => state.setRate);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [form] = Form.useForm();
  const rows = useMemo((): FxRow[] => {
    return Object.values(fxRates)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((item) => ({
        key: item.month,
        month: item.month,
        rate: item.rate.toFixed(2),
        source: item.source,
      }));
  }, [fxRates]);

  const handleAddFx = async (): Promise<void> => {
    const values = await form.validateFields();
    const monthValue = values.month.format('YYYY-MM');
    const rateValue = Number(values.rate);
    setRate(monthValue, rateValue, values.source);
    message.success('Курс обновлён, данные пересчитаны');
    form.resetFields();
    setModalOpen(false);
  };

  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="FX"
        description="Курсы валют и ручные корректировки."
        actions={
          <Button type="link">
            <Link to="/directories">← Назад к справочникам</Link>
          </Button>
        }
      />
      <Card>
        <div className="flex items-center justify-between mb-4">
          <Typography.Text strong>Курсы USD → RUB</Typography.Text>
          <Button size="small" type="primary" onClick={(): void => setModalOpen(true)}>Загрузить курс</Button>
        </div>
        <Table
          size="small"
          pagination={false}
          dataSource={rows}
          columns={[
            { title: 'Месяц', dataIndex: 'month', key: 'month' },
            { title: 'Курс', dataIndex: 'rate', key: 'rate' },
            { title: 'Источник', dataIndex: 'source', key: 'source' },
          ]}
        />
      </Card>

      <Modal
        title="Добавить курс"
        open={modalOpen}
        onCancel={(): void => {
          form.resetFields();
          setModalOpen(false);
        }}
        onOk={(): Promise<void> => handleAddFx()}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="month" label="Месяц" rules={[{ required: true, message: 'Выберите месяц' }]}>
            <DatePicker picker="month" className="w-full" />
          </Form.Item>
          <Form.Item name="rate" label="Курс" rules={[{ required: true, message: 'Введите курс' }]}>
            <InputNumber className="w-full" min={0} step={0.01} placeholder="92.40" />
          </Form.Item>
          <Form.Item name="source" label="Источник" rules={[{ required: true, message: 'Укажите источник' }]}>
            <Input placeholder="Например, ЦБ РФ" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
