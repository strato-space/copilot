import { Alert, Badge, Button, Card, Col, Row, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { type ReactElement, useEffect, useMemo } from 'react';
import PageHeader from '../components/PageHeader';
import GuideSourceTag from '../components/GuideSourceTag';
import { type GuideSource, useGuideStore } from '../store/guideStore';

interface DirectoryCard {
  title: string;
  description: string;
  to?: string;
  available: boolean;
  directories?: Array<{ name: string; label: string }>;
  badges?: string[];
}

interface GuideModuleSection {
  title: string;
  description: string;
  cards: DirectoryCard[];
}

const modules: GuideModuleSection[] = [
  {
    title: 'Core',
    description: 'Базовые справочники, общие для всех модулей.',
    cards: [
      {
        title: 'Клиенты / Проекты / Ставки',
        description: 'Контракты, структура проектов и базовые ставки.',
        to: '/guide/clients-projects-rates',
        available: true,
        directories: [
          { name: 'clients', label: 'Клиенты' },
          { name: 'projects', label: 'Проекты' },
          { name: 'project-rates', label: 'Ставки' },
        ],
        badges: ['read-only'],
      },
      {
        title: 'Исполнители / Зарплаты',
        description: 'Команды, роли и база для расчёта себестоимости.',
        to: '/guide/employees-salaries',
        available: true,
        directories: [
          { name: 'people', label: 'Люди' },
          { name: 'employee-month-cost', label: 'Зарплаты' },
        ],
        badges: ['read-only'],
      },
      {
        title: 'Агенты',
        description: 'Правила работы и сценарии автоматизации.',
        to: '/guide/agents',
        available: true,
        directories: [{ name: 'agents', label: 'Агенты' }],
        badges: ['read-only'],
      },
      {
        title: 'Teams / Roles / Task Types / Aliases',
        description: 'Отдельные справочники Core (пока без UI).',
        available: false,
        badges: ['скоро'],
      },
    ],
  },
  {
    title: 'FinOps',
    description: 'Финансовые справочники и параметры расчётов.',
    cards: [
      {
        title: 'FX',
        description: 'Курсы валют и ручные корректировки.',
        to: '/guide/fx',
        available: true,
        directories: [{ name: 'fx', label: 'FX' }],
        badges: ['read-only'],
      },
      {
        title: 'Категории расходов / Income Types / Alerts',
        description: 'Планируется для следующего этапа.',
        available: false,
        badges: ['скоро'],
      },
    ],
  },
  {
    title: 'OperOps',
    description: 'Эпики и опер‑контекст проектов.',
    cards: [
      {
        title: 'Epics',
        description: 'Связанные с проектами эпики (read-only).',
        available: false,
        badges: ['скоро'],
      },
    ],
  },
  {
    title: 'ChatOps / SaleOps / HHOps',
    description: 'Будущие модули и справочники.',
    cards: [
      {
        title: 'Leads / Offers / Leave Schedule',
        description: 'Появятся после стабилизации Core/FinOps.',
        available: false,
        badges: ['скоро'],
      },
    ],
  },
];

const formatCounts = (counts: Array<{ label: string; count: number }>): string => {
  if (counts.length === 0) {
    return 'нет данных';
  }
  return counts.map((item) => `${item.label}: ${item.count}`).join(' • ');
};

const uniqueSources = (sources: Array<GuideSource | undefined>): GuideSource[] => {
  const set = new Set<GuideSource>();
  sources.forEach((source) => {
    if (source) {
      set.add(source);
    }
  });
  return Array.from(set);
};

export default function DirectoriesPage(): ReactElement {
  const index = useGuideStore((state) => state.index);
  const indexLoading = useGuideStore((state) => state.indexLoading);
  const indexError = useGuideStore((state) => state.indexError);
  const fetchIndex = useGuideStore((state) => state.fetchIndex);

  useEffect((): void => {
    void fetchIndex();
  }, [fetchIndex]);

  const indexMap = useMemo(() => new Map(index.map((item) => [item.name, item])), [index]);

  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="Guide"
        description="Общие справочники и настройки, используемые всеми разделами OPS."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={<ReloadOutlined />} onClick={(): void => void fetchIndex()}>
              Import / Обновить
            </Button>
            <Button disabled>Export</Button>
            <Button disabled>Audit</Button>
          </div>
        )}
        extra={(
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge status="processing" text="MVP0: read-only" />
            <span>Источник master: automation CRM</span>
          </div>
        )}
      />
      {indexError ? (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          message="Не удалось загрузить список справочников"
          description={indexError}
        />
      ) : null}

      {modules.map((section) => (
        <div key={section.title}>
          <div className="mb-3">
            <Typography.Title level={5} className="!mb-1">{section.title}</Typography.Title>
            <Typography.Text type="secondary">{section.description}</Typography.Text>
          </div>
          <Row gutter={[16, 16]}>
            {section.cards.map((card) => {
              const counts = card.directories
                ? card.directories.map((dir) => ({
                  label: dir.label,
                  count: indexMap.get(dir.name)?.count ?? 0,
                }))
                : [];
              const sources = card.directories
                ? uniqueSources(card.directories.map((dir) => indexMap.get(dir.name)?.source))
                : [];
              const content = (
                <Card hoverable={card.available} loading={indexLoading} className={card.available ? '' : 'opacity-70'}>
                  <div className="flex items-center justify-between gap-2">
                    <Typography.Title level={5} className="!mb-0">{card.title}</Typography.Title>
                    <div className="flex items-center gap-1">
                      {card.available
                        ? sources.length > 0
                          ? sources.map((source) => <GuideSourceTag key={source} source={source} />)
                          : <GuideSourceTag source="unknown" />
                        : card.badges?.map((badge) => <Tag key={badge}>{badge}</Tag>)}
                    </div>
                  </div>
                  <Typography.Text type="secondary" className="block mt-1">
                    {card.description}
                  </Typography.Text>
                  {card.directories ? (
                    <Typography.Text type="secondary" className="block mt-3 text-xs">
                      {formatCounts(counts)}
                    </Typography.Text>
                  ) : null}
                </Card>
              );

              return (
                <Col xs={24} md={12} lg={8} key={card.title}>
                  {card.available && card.to ? (
                    <Link to={card.to}>{content}</Link>
                  ) : (
                    content
                  )}
                </Col>
              );
            })}
          </Row>
        </div>
      ))}
    </div>
  );
}
