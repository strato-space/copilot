import CategorizationTableRow from "./CategorizationTableRow";

const CategorizationTableMessages = ({ group }) => (
    <div className="flex-1 flex flex-col min-h-0">
        {group.rows.map((row, i) => (
            <CategorizationTableRow row={row} key={i} isLast={i === group.rows.length - 1} />
        ))}
    </div>
);

export default CategorizationTableMessages;
