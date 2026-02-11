import React from 'react';

import { useKanbanStore } from '../../../store/kanbanStore';

interface BonusCalculatorProps {
    stats: {
        totalWorkHours: number;
        daysBelowANormal: number;
        totalDaysWithWork: number;
        averageReviewsCount: number;
        ticketWithReviewCount: number;
        ticketsAboveNormalTimeBetweenReadyAndReview: number;
    };
    paymentData: {
        payment_type?: 'hourly' | 'monthly';
        hourly_rate?: number;
        monthly_rate?: number;
        custom_bonus?: number;
        tax?: number;
    };
}

const BonusCalculator: React.FC<BonusCalculatorProps> = ({ stats, paymentData }) => {
    const calculateBonus = useKanbanStore((state) => state.calculateBonus);
    const normalizedPaymentData = {
        payment_type: paymentData.payment_type ?? 'monthly',
        ...(paymentData.hourly_rate != null ? { hourly_rate: paymentData.hourly_rate } : {}),
        ...(paymentData.monthly_rate != null ? { monthly_rate: paymentData.monthly_rate } : {}),
        ...(paymentData.custom_bonus != null ? { custom_bonus: paymentData.custom_bonus } : {}),
        ...(paymentData.tax != null ? { tax: paymentData.tax } : {}),
    };
    const bonusData = calculateBonus(stats, normalizedPaymentData);
    const paymentType = paymentData.payment_type;
    const payment =
        paymentType === 'hourly'
            ? (paymentData.hourly_rate ?? 0) * stats.totalWorkHours
            : paymentData.monthly_rate ?? 0;

    return (
        <>
            <h2 className="text-[20px]">Расчет выплаты:</h2>
            <p>
                {paymentType === 'hourly'
                    ? `Почасовая ставка: ${paymentData.hourly_rate} * ${stats.totalWorkHours} = ${payment}`
                    : `Ежемесячная ставка: ${paymentData.monthly_rate}`}
            </p>
            <p>Бонус за стабильность: {bonusData.k_hours.toFixed(2)}</p>
            <p>Бонус за ревью: {bonusData.k_review.toFixed(2)}</p>
            <p>Бонус за скорость: {bonusData.k_speed.toFixed(2)}</p>
            <p>Базовый бонус: {bonusData.basicBonus}</p>
            {paymentData.custom_bonus ? <p>Индивидуальный бонус: {paymentData.custom_bonus}</p> : null}
            <p>Итоговый бонус: {Math.round(bonusData.bonus)}</p>
            <p>Итоговая сумма: {Math.round(bonusData.total)}</p>
            {paymentData.tax ? <p>Компенсированный налог: {Math.round(bonusData.taxCompensation ?? 0)}</p> : null}
            {paymentData.tax ? (
                <p>Итоговая сумма с компенсацией налога: {Math.round(bonusData.taxed ?? 0)}</p>
            ) : null}
        </>
    );
};

export default BonusCalculator;
