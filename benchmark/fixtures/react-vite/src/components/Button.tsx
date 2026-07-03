export interface ButtonProps {
  label: string;
  variant?: 'primary';
}

export default function Button({ label, variant = 'primary' }: ButtonProps) {
  return <button className={`btn btn-${variant}`}>{label}</button>;
}
