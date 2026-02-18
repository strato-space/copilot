import React from 'react';

/**
 * Question component displays a question with optional level, topic, priority, and goal.
 * @param {Object} props
 * @param {Object} props.q - Question object with fields: level, question, topic, priority, goal
 * @param {number|string} props.idx - Unique key/index for the component
 */
const Question = ({ q }) => (
  <div className="flex-1 justify-center">
    <span className="text-[#08979c] text-[11px] font-normal sf-pro leading-none">{q.level || ''}</span>
    <span className="text-black/25 text-[11px] font-normal sf-pro leading-none"> • </span>
    <span className="text-black/90 text-[11px] font-normal sf-pro leading-none">{q.question}</span>
    {q.topic && <><span className="text-black/25 text-[11px] font-normal sf-pro leading-none"> | </span><span className="text-[#52c41a] text-[11px] font-normal sf-pro leading-none">{q.topic}</span></>}
    {q.priority && <><span className="text-black/25 text-[11px] font-normal sf-pro leading-none"> | </span><span className="text-[#faad14] text-[11px] font-normal sf-pro leading-none">{q.priority}</span></>}
    {q.goal && <><span className="text-black/25 text-[11px] font-normal sf-pro leading-none"> | </span><span className="text-[#722ed1] text-[11px] font-normal sf-pro leading-none">{q.goal}</span></>}
  </div>
);

export default Question;