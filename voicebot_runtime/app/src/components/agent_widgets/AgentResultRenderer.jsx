import React from 'react';
import { Alert } from 'antd';
import { AGENT_OUTPUT_TYPES, AGENT_LAYOUTS, AGENT_CONTENT_TYPES } from '../../constants/agent_results';
import AgentTableWidget from './AgentTableWidget';
import AgentTextWidget from './AgentTextWidget';
import AgentYamlWidget from './AgentYamlWidget';

const AgentResultRenderer = ({ result, agentName, agentSpecs }) => {
    if (!result?.data) {
        return (
            <Alert
                type="warning"
                message="No result data available"
                style={{ margin: 16 }}
            />
        );
    }

    const { data } = result;

    // Карта компонентов для различных типов контента
    const componentMap = {
        [`${AGENT_OUTPUT_TYPES.WEB_OUTPUT}-${AGENT_LAYOUTS.MAIN_COLUMN}-${AGENT_CONTENT_TYPES.TABLE}`]: AgentTableWidget,
        [`${AGENT_OUTPUT_TYPES.WEB_OUTPUT}-${AGENT_LAYOUTS.MAIN_COLUMN}-${AGENT_CONTENT_TYPES.TEXT}`]: AgentTextWidget,
        [`${AGENT_OUTPUT_TYPES.WEB_OUTPUT}-${AGENT_LAYOUTS.MAIN_COLUMN}-${AGENT_CONTENT_TYPES.YAML}`]: AgentYamlWidget,
    };

    // Создаем ключ для поиска компонента
    const componentKey = `${data.type}-${data.layout}-${data.content_type}`;
    const Component = componentMap[componentKey];

    // Если найден подходящий компонент, рендерим его
    if (Component) {
        return (
            <Component
                data={data}
                agentName={agentName}
                agentSpecs={agentSpecs}
            />
        );
    }

    // Определяем тип ошибки для более понятного сообщения
    const getErrorMessage = () => {
        if (data.type !== AGENT_OUTPUT_TYPES.WEB_OUTPUT) {
            return {
                message: `Unsupported output type: ${data.type}`,
                description: "This output type is not yet implemented."
            };
        }

        if (data.layout !== AGENT_LAYOUTS.MAIN_COLUMN) {
            return {
                message: `Unsupported layout: ${data.layout}`,
                description: "This layout is not yet implemented."
            };
        }

        return {
            message: `Unsupported content type: ${data.content_type}`,
            description: "This content type is not yet implemented."
        };
    };

    const errorInfo = getErrorMessage();
    return (
        <Alert
            type="info"
            message={errorInfo.message}
            description={errorInfo.description}
            style={{ margin: 16 }}
        />
    );
};

export default AgentResultRenderer;
