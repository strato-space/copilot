import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { useContext } from '../../store/context';

const TextSelectionHandler = ({
    containerRef = null,
    disabled = false,
    source = null
}) => {
    const [selection, setSelection] = useState(null);
    const [buttonPosition, setButtonPosition] = useState({ x: 0, y: 0 });
    const [showButton, setShowButton] = useState(false);
    const timeoutRef = useRef(null);
    const { addTextToContext } = useContext();

    const handleMouseUp = (event) => {
        if (disabled) return;

        // Очищаем предыдущий таймаут
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // Небольшая задержка для обработки выделения
        timeoutRef.current = setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            if (selectedText && selectedText.length > 0) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();

                // Получаем позицию контейнера если он указан
                let containerRect = { left: 0, top: 0 };
                if (containerRef?.current) {
                    containerRect = containerRef.current.getBoundingClientRect();
                }

                setSelection({
                    text: selectedText,
                    range: range
                });

                // Позиционируем кнопку рядом с выделенным текстом
                setButtonPosition({
                    x: rect.right + window.scrollX + 5,
                    y: rect.top + window.scrollY - 5
                });

                setShowButton(true);
            } else {
                setShowButton(false);
                setSelection(null);
            }
        }, 100);
    };

    const handleAddToContext = () => {
        if (selection && selection.text) {
            addTextToContext(selection.text, source);
            setShowButton(false);
            setSelection(null);

            // Снимаем выделение
            window.getSelection().removeAllRanges();
        }
    };

    const handleDocumentClick = (event) => {
        // Скрываем кнопку при клике вне выделенного текста
        if (!event.target.closest('.text-selection-button')) {
            setShowButton(false);
            setSelection(null);
        }
    };

    useEffect(() => {
        const targetElement = containerRef?.current || document;

        // Обработчики для работы с выделением
        targetElement.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('click', handleDocumentClick);

        // Обработчик для iframe (если есть)
        const handleIframeSelection = () => {
            try {
                const iframes = document.querySelectorAll('iframe');
                iframes.forEach(iframe => {
                    try {
                        if (iframe.contentDocument) {
                            iframe.contentDocument.addEventListener('mouseup', handleMouseUp);
                        }
                    } catch (e) {
                        // Iframe может быть заблокирован из-за CORS
                        console.warn('Cannot access iframe content:', e);
                    }
                });
            } catch (e) {
                console.warn('Error setting up iframe listeners:', e);
            }
        };

        // Устанавливаем обработчики для существующих iframe
        handleIframeSelection();

        // Следим за добавлением новых iframe
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'IFRAME') {
                        try {
                            if (node.contentDocument) {
                                node.contentDocument.addEventListener('mouseup', handleMouseUp);
                            }
                        } catch (e) {
                            console.warn('Cannot access new iframe content:', e);
                        }
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        return () => {
            targetElement.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('click', handleDocumentClick);
            observer.disconnect();

            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }

            // Очищаем обработчики iframe
            try {
                const iframes = document.querySelectorAll('iframe');
                iframes.forEach(iframe => {
                    try {
                        if (iframe.contentDocument) {
                            iframe.contentDocument.removeEventListener('mouseup', handleMouseUp);
                        }
                    } catch (e) {
                        // Игнорируем ошибки при очистке
                    }
                });
            } catch (e) {
                // Игнорируем ошибки при очистке
            }
        };
    }, [containerRef, disabled, source]);

    if (!showButton || !selection) {
        return null;
    }

    return createPortal(
        <div
            className="text-selection-button fixed z-50"
            style={{
                left: `${buttonPosition.x}px`,
                top: `${buttonPosition.y}px`,
                pointerEvents: 'auto'
            }}
        >
            <Tooltip title="Добавить выделенный текст в контекст" placement="top">
                <Button
                    type="primary"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={handleAddToContext}
                    className="shadow-lg border-0"
                    style={{
                        minWidth: '32px',
                        height: '32px',
                        borderRadius: '6px'
                    }}
                />
            </Tooltip>
        </div>,
        document.body
    );
};

export default TextSelectionHandler;
