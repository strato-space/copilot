import React, { useState, useEffect } from 'react';
import { Card, Typography, Spin, Alert, Button, Table, Tabs, Select } from 'antd';
import { EyeOutlined, TableOutlined, FileExcelOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { useFilesPreview } from '../../store/files_preview';

const { Text } = Typography;

const ExcelPreview = ({ file }) => {
    const [workbook, setWorkbook] = useState(null);
    const [sheetNames, setSheetNames] = useState([]);
    const [activeSheet, setActiveSheet] = useState('');
    const [sheetData, setSheetData] = useState([]);
    const [columns, setColumns] = useState([]);
    const [parseError, setParseError] = useState(null);

    // Используем store для управления состоянием файлов
    const { fetchFileContent, getFileContent } = useFilesPreview();

    // Получаем данные из store
    const fileData = getFileContent(file?.file_id);
    const { content = '', loading = false, error = null, contentType = null } = fileData;

    useEffect(() => {
        if (file && file.file_id && !content && !loading && !error) {
            fetchFileContent(file.file_id).catch(() => {
                // Ошибка уже обрабатывается в store
            });
        }
    }, [file, content, loading, error, fetchFileContent]);

    useEffect(() => {
        if (content && contentType === 'binary_base64') {
            parseExcelFile(content);
        }
    }, [content, contentType]);

    const parseExcelFile = (base64Content) => {
        try {
            setParseError(null);

            // Проверяем, что содержимое файла не пустое
            if (!base64Content || base64Content === 'e30=') {
                setParseError(
                    'Файл не был загружен с Google Drive. ' +
                    'Бэкенд вернул пустое содержимое (e30= = {}). ' +
                    'Проблема может быть в правах доступа к Google Drive API или в методе загрузки файла на сервере.'
                );
                return;
            }

            // Очищаем base64 строку от возможных символов переноса строк и пробелов
            const cleanBase64Content = base64Content.replace(/\s/g, '');

            // Проверяем валидность base64 строки
            const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
            if (!base64Regex.test(cleanBase64Content)) {
                setParseError(`Некорректный формат base64 данных. Длина: ${cleanBase64Content.length}, первые символы: "${cleanBase64Content.substring(0, 50)}..."`);
                return;
            }

            // Конвертируем base64 обратно в ArrayBuffer для xlsx
            let binaryString;
            try {
                binaryString = atob(cleanBase64Content);
            } catch (atobError) {
                setParseError(`Ошибка декодирования base64: ${atobError.message}. Возможно, данные повреждены на сервере.`);
                console.error('Base64 decode error. Content length:', cleanBase64Content.length);
                console.error('First 200 chars:', cleanBase64Content.substring(0, 200));
                return;
            }

            // Проверяем размер декодированных данных
            if (binaryString.length < 100) {
                setParseError(`Файл слишком мал (${binaryString.length} байт). Возможно, файл поврежден или не был загружен полностью.`);
                return;
            }

            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Проверяем сигнатуру Excel файла (первые несколько байт)
            const signature = Array.from(bytes.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
            console.log('File signature:', signature);

            // Парсим Excel файл
            const workbook = XLSX.read(bytes, { type: 'array' }); setWorkbook(workbook);
            setSheetNames(workbook.SheetNames);

            // Выбираем первый лист по умолчанию
            if (workbook.SheetNames.length > 0) {
                const firstSheetName = workbook.SheetNames[0];
                setActiveSheet(firstSheetName);
                loadSheetData(workbook, firstSheetName);
            }

        } catch (err) {
            console.error('Error parsing Excel file:', err);
            setParseError('Ошибка при парсинге Excel файла: ' + err.message);
        }
    };

    const loadSheetData = (workbook, sheetName) => {
        try {
            const worksheet = workbook.Sheets[sheetName];

            // Конвертируем в JSON с header 1 (первая строка как заголовки)
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length === 0) {
                setColumns([]);
                setSheetData([]);
                return;
            }

            // Первая строка - заголовки
            const headers = jsonData[0] || [];
            const dataRows = jsonData.slice(1);

            // Создаем колонки для Ant Design Table
            const columns = headers.map((header, index) => ({
                title: header || `Колонка ${index + 1}`,
                dataIndex: `col_${index}`,
                key: `col_${index}`,
                width: 150,
                ellipsis: true,
                render: (text) => {
                    // Обрабатываем различные типы данных
                    if (text === null || text === undefined) return '';
                    if (typeof text === 'number') return text.toString();
                    if (typeof text === 'boolean') return text ? 'TRUE' : 'FALSE';
                    return text.toString();
                }
            }));

            // Создаем данные для таблицы
            const tableData = dataRows.map((row, rowIndex) => {
                const rowData = { key: rowIndex };
                headers.forEach((_, colIndex) => {
                    rowData[`col_${colIndex}`] = row[colIndex] || '';
                });
                return rowData;
            });

            setColumns(columns);
            setSheetData(tableData);

        } catch (err) {
            console.error('Error loading sheet data:', err);
            setParseError('Ошибка при загрузке данных листа: ' + err.message);
        }
    };

    const handleSheetChange = (newSheetName) => {
        setActiveSheet(newSheetName);
        if (workbook) {
            loadSheetData(workbook, newSheetName);
        }
    };

    const refetchContent = () => {
        if (file && file.file_id) {
            setWorkbook(null);
            setSheetNames([]);
            setActiveSheet('');
            setSheetData([]);
            setColumns([]);
            setParseError(null);

            fetchFileContent(file.file_id).catch(() => {
                // Ошибка уже обрабатывается в store
            });
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Spin size="large" />
                <Text className="ml-2">Загрузка Excel файла...</Text>
            </div>
        );
    }

    if (error) {
        return (
            <Alert
                message="Ошибка загрузки файла"
                description={
                    <div>
                        <p>{error}</p>
                        <Button
                            type="link"
                            onClick={refetchContent}
                            className="p-0"
                        >
                            Попробовать еще раз
                        </Button>
                        <br />
                        {file.web_view_link && (
                            <a
                                href={file.web_view_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 underline"
                            >
                                Открыть в Google Drive
                            </a>
                        )}
                    </div>
                }
                type="error"
                showIcon
            />
        );
    }

    if (parseError) {
        return (
            <Alert
                message="Ошибка парсинга Excel файла"
                description={
                    <div className="space-y-3">
                        <p>{parseError}</p>
                        <div className="space-y-2">
                            <Button
                                type="link"
                                onClick={refetchContent}
                                className="p-0"
                            >
                                Попробовать еще раз
                            </Button>
                            <br />
                            {file.web_view_link && (
                                <a
                                    href={file.web_view_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-block px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                                >
                                    Открыть в Google Sheets
                                </a>
                            )}
                        </div>
                    </div>
                }
                type="warning"
                showIcon
            />
        );
    }

    if (!content) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-gray-500">
                <FileExcelOutlined className="text-6xl mb-4" />
                <Text type="secondary">Файл пустой или недоступен</Text>
            </div>
        );
    }

    if (!workbook || sheetNames.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-gray-500">
                <FileExcelOutlined className="text-6xl mb-4" />
                <Text type="secondary">Excel файл не содержит листов данных</Text>
            </div>
        );
    }

    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            {/* Переключатель листов и информация */}
            <div className="flex justify-between items-center mb-3 border-b pb-2 px-4 flex-shrink-0">
                <div className="flex items-center gap-3">
                    <TableOutlined className="text-green-500" />
                    <Text strong>Лист Excel:</Text>
                    <Select
                        value={activeSheet}
                        onChange={handleSheetChange}
                        style={{ width: 200 }}
                        size="small"
                    >
                        {sheetNames.map(sheetName => (
                            <Select.Option key={sheetName} value={sheetName}>
                                {sheetName}
                            </Select.Option>
                        ))}
                    </Select>
                </div>

                <div className="text-sm text-gray-500">
                    Строк: {sheetData.length} | Колонок: {columns.length}
                </div>
            </div>

            {/* Таблица с данными */}
            <div className="flex-1 w-full">
                {sheetData.length > 0 ? (
                    <Table
                        columns={columns}
                        dataSource={sheetData}
                        scroll={{ x: '1000px', y: 'calc(100vh - 380px)' }}
                        pagination={{
                            pageSize: 100,
                            showSizeChanger: true,
                            showQuickJumper: true,
                            showTotal: (total, range) =>
                                `${range[0]}-${range[1]} из ${total} строк`,
                        }}
                        size="small"
                        bordered
                        className="excel-preview-table"
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
                        <TableOutlined className="text-4xl mb-2" />
                        <Text type="secondary">Лист "{activeSheet}" пустой</Text>
                    </div>
                )}
            </div>

            {/* Информация о файле */}
            <div className="mt-3 pt-3 border-t text-xs text-gray-500">
                <Text type="secondary">
                    Размер: {file.file_size ? `${Math.round(file.file_size / 1024)} KB` : 'Неизвестно'} |
                    Листов: {sheetNames.length} |
                    Активный лист: {activeSheet}
                </Text>
            </div>

            <style jsx>{`
                .excel-preview-table .ant-table-thead > tr > th {
                    background-color: #f0f9ff;
                    font-weight: 600;
                }
                .excel-preview-table .ant-table-tbody > tr:nth-child(even) {
                    background-color: #fafafa;
                }
                .excel-preview-table .ant-table-tbody > tr:hover > td {
                    background-color: #e6f7ff;
                }
                .ant-table-body {
                    scrollbar-width: thin;
                    min-height: 450px;
                }
            `}</style>
        </div>
    );
};

export default ExcelPreview;
