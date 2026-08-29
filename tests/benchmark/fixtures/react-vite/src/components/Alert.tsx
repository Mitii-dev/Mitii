export interface AlertProps {
  message: string;
  tone?: 'info' | 'error';
}

/** Presentational alert — seeded a11y bug: role should be "alert". */
export default function Alert({ message, tone = 'info' }: AlertProps) {
  return (
    <div className={`alert alert-${tone}`} role="status">
      {message}
    </div>
  );
}
