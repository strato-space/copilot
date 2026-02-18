import React, { useState } from "react";
import { EllipsisOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Button } from 'antd';

export default function Widget({ title, icon, items, version, versionDate }) {
    const [page, setPage] = useState(0);
    const pageSize = 5;
    const pageCount = Math.ceil(items.length / pageSize);
    const pagedItems = items.slice(page * pageSize, (page + 1) * pageSize);
    const canPrev = page > 0;
    const canNext = page < pageCount - 1;

    return (
        <div className="w-[360px] bg-white rounded-lg shadow-sm inline-flex flex-col justify-start items-center overflow-hidden">
            <div className="self-stretch px-3 py-1 shadow-sm border-b border-[#d9d9d9] inline-flex justify-between items-center gap-1">
                <div className="flex-1 flex justify-start items-center gap-1">
                    <div className="flex-1 flex justify-start items-center gap-2">
                        {icon}
                        <div className="justify-center text-black/40 text-xs font-semibold sf-pro leading-none">{title}</div>
                        <div className="justify-center text-black/25 text-xs font-semibold sf-pro leading-none">{items.length}</div>
                    </div>
                    {/* <div className="justify-center text-black/25 text-xs font-semibold sf-pro leading-none">v {version}: {versionDate}</div> */}
                </div>
                {/* <Button
                    type="text"
                    icon={<EllipsisOutlined className="text-black/90 text-lg" />}
                    className="w-6 h-6 px-1 flex justify-center items-center hover:bg-black/5"
                /> */}
                <div className="flex items-center gap-2">
                    <div className="flex justify-start items-start gap-1.5 max-w-32 overflow-auto smart-scroll">
                        {[...Array(pageCount)].map((_, i) => (
                            <div
                                key={i}
                                className={`w-1.5 h-1.5 shrink-0 rounded-full ${i === page ? 'bg-[#1677ff]' : 'bg-black/20'}`}
                            />
                        ))}
                    </div>
                    <div className="flex justify-start items-start gap-1">
                        <Button
                            type="text"
                            icon={<LeftOutlined className="text-black/90 w-3 h-3" />}
                            className="w-3 h-5 flex justify-center items-center hover:bg-black/5"
                            onClick={() => canPrev && setPage(page - 1)}
                            disabled={!canPrev}
                        />
                        <Button
                            type="text"
                            icon={<RightOutlined className="text-black/90 w-3 h-3" />}
                            className="w-3 h-5 flex justify-center items-center hover:bg-black/5"
                            onClick={() => canNext && setPage(page + 1)}
                            disabled={!canNext}
                        />
                    </div>
                </div>
            </div>
            <div className="grow-0 shrink-0 h-[292px] px-3 py-2 overflow-auto smart-scroll">
                <div className="flex flex-col justify-end items-center gap-1">
                    {pagedItems.map((item, index) => (
                        <div key={index + page * pageSize} className="self-stretch px-1 py-[2px] inline-flex justify-center items-center leading-[14px]">
                            {item}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

