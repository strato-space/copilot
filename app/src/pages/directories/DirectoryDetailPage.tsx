import { Alert, Button, Tabs, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Link, useParams } from 'react-router-dom';
import { type ReactElement, useEffect, useMemo } from 'react';
import PageHeader from '../../components/PageHeader';
import GuideSourceTag from '../../components/GuideSourceTag';
import { DIRECTORY_GROUPS, buildDirectoryTable } from '../../services/guideDirectoryConfig';
import { type GuideSource, useGuideStore } from '../../store/guideStore';

const uniqueSources = (sources: Array<GuideSource | undefined>): GuideSource[] => {
  const set = new Set<GuideSource>();
  sources.forEach((source) => {
    if (source) {
      set.add(source);
    }
  });
  return Array.from(set);
};

export default function DirectoryDetailPage(): ReactElement {
  const { groupKey } = useParams<{ groupKey: string }>();
  const group = DIRECTORY_GROUPS.find((item) => item.key === groupKey);

  const directories = useGuideStore((state) => state.directories);
  const directoryLoading = useGuideStore((state) => state.directoryLoading);
  const directoryError = useGuideStore((state) => state.directoryError);
  const fetchDirectory = useGuideStore((state) => state.fetchDirectory);
  const extraDirectories = useMemo(() => {
    if (group?.key === 'people-salaries') {
      return ['teams', 'roles'];
    }
    return [];
  }, [group]);
  const directoryNames = useMemo(() => {
    if (!group) {
      return extraDirectories;
    }
    return [...group.directories.map((dir) => dir.name), ...extraDirectories];
  }, [extraDirectories, group]);

  useEffect((): void => {
    if (!group) {
      return;
    }
    directoryNames.forEach((name) => void fetchDirectory(name));
  }, [directoryNames, fetchDirectory, group]);

  if (!group) {
    return (
      <div className="finops-page animate-fade-up">
        <PageHeader
          title="Справочник не найден"
          description="Проверьте ссылку или вернитесь в каталог."
          actions={(
            <Button type="link">
              <Link to="/guide">← Назад к Guide</Link>
            </Button>
          )}
        />
      </div>
    );
  }

  const sources = uniqueSources(group.directories.map((dir) => directories[dir.name]?.source));
  const errors = directoryNames
    .map((name) => directoryError[name])
    .filter(Boolean) as string[];

  const tabs = group.directories.map((dir) => {
    const table = buildDirectoryTable(dir.name, directories);
    return {
      key: dir.name,
      label: dir.label,
      children: (
        <Table
          size="small"
          pagination={false}
          dataSource={table.data}
          columns={table.columns}
          locale={{ emptyText: table.emptyText ?? 'Нет данных' }}
          loading={Boolean(directoryLoading[dir.name])}
          sticky
        />
      ),
    };
  });

  return (
    <div className="finops-page animate-fade-up">
      <Button type="link" className="!p-0 mb-2">
        <Link to="/guide">← Назад к Guide</Link>
      </Button>
      <PageHeader
        title={group.title}
        description={group.description}
        actions={(
          <Button
            icon={<ReloadOutlined />}
            onClick={(): void => {
              directoryNames.forEach((name) => void fetchDirectory(name));
            }}
          >
            Обновить
          </Button>
        )}
        extra={(
          <div className="flex flex-wrap items-center gap-2">
            <Tag>{group.module}</Tag>
            {sources.length > 0
              ? sources.map((source) => <GuideSourceTag key={source} source={source} />)
              : <GuideSourceTag source="unknown" />}
          </div>
        )}
      />

      {errors.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          message="Не удалось загрузить часть данных"
          description={errors.join(' / ')}
        />
      ) : null}

      {tabs.length === 1 ? (
        <div>
          <Typography.Text type="secondary" className="block mb-2">
            {tabs[0]?.label}
          </Typography.Text>
          {tabs[0]?.children}
        </div>
      ) : (
        <Tabs items={tabs} />
      )}
    </div>
  );
}
