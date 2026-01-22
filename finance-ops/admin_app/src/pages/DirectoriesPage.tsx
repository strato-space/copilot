import { Card, Col, Row, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { type ReactElement } from 'react';
import PageHeader from '../components/PageHeader';

interface DirectoryCard {
  title: string;
  description: string;
  to: string;
}

const directoryCards: DirectoryCard[] = [
  {
    title: 'Клиенты / Проекты / Ставки',
    description: 'Контракты, структура проектов и базовые ставки.',
    to: '/directories/clients-projects-rates',
  },
  {
    title: 'Исполнители / Зарплаты',
    description: 'Команды, роли и база для расчёта себестоимости.',
    to: '/directories/employees-salaries',
  },
  {
    title: 'FX',
    description: 'Курсы валют и ручные корректировки с комментариями.',
    to: '/directories/fx',
  },
  {
    title: 'Агенты',
    description: 'Правила работы и сценарии автоматизации.',
    to: '/directories/agents',
  },
];

export default function DirectoriesPage(): ReactElement {
  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="Справочники"
        description="Управление ключевыми списками и настройками, которые используются в финансах."
      />
      <Row gutter={[16, 16]}>
        {directoryCards.map((card: DirectoryCard): ReactElement => (
          <Col xs={24} md={12} lg={8} key={card.title}>
            <Link to={card.to}>
              <Card hoverable>
                <Typography.Title level={5}>{card.title}</Typography.Title>
                <Typography.Text type="secondary">{card.description}</Typography.Text>
              </Card>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  );
}
