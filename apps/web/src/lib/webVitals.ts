import { onCLS, onINP, onLCP, type Metric } from 'web-vitals';

function logMetric(metric: Metric) {
  console.info(`[web-vitals] ${metric.name}`, {
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
  });
}

export function reportWebVitals() {
  onCLS(logMetric);
  onINP(logMetric);
  onLCP(logMetric);
}
