import React, { useMemo } from "react";
import { Select } from "antd";

const UNGROUPED_LABEL = "Без группы";

const normalizeStr = (v) => (typeof v === "string" ? v : "");

const buildGroupedProjectOptions = (preparedProjects) => {
    const projects = Array.isArray(preparedProjects) ? preparedProjects : [];

    // groupKey -> projects[]
    const groups = new Map();
    for (const p of projects) {
        const groupKey = normalizeStr(p?.project_group?.name);
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(p);
    }

    const entries = Array.from(groups.entries());
    entries.sort(([a], [b]) => {
        if (a === "" && b !== "") return -1;
        if (b === "" && a !== "") return 1;
        return a.localeCompare(b, undefined, { sensitivity: "base" });
    });

    return entries.map(([groupKey, groupProjects]) => ({
        label: groupKey || UNGROUPED_LABEL,
        title: groupKey || UNGROUPED_LABEL,
        options: groupProjects
            .slice()
            .sort((a, b) =>
                normalizeStr(a?.name).localeCompare(normalizeStr(b?.name), undefined, { sensitivity: "base" })
            )
            .map((p) => ({
                label: p?.name || "(unnamed project)",
                value: p?._id,
            })),
    }));
};

const ProjectSelect = ({ preparedProjects, placeholder = "Проект", ...props }) => {
    const options = useMemo(() => buildGroupedProjectOptions(preparedProjects), [preparedProjects]);

    return (
        <Select
            placeholder={placeholder}
            options={options}
            showSearch={true}
            optionFilterProp="label"
            filterOption={(inputValue, option) =>
                normalizeStr(option?.label).toLowerCase().includes(normalizeStr(inputValue).toLowerCase())
            }
            {...props}
        />
    );
};

export default ProjectSelect;

