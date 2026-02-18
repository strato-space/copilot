import React from 'react';

const WidgetStub = ({ name, data }) => (
  <div className="text-xs text-gray-400 p-2">Widget "{name}" preview not implemented.<br/>Data: {JSON.stringify(data)}</div>
);

export default WidgetStub;
