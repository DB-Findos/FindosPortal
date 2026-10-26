export type Row = Record<string, any>;
export type Field = {
  readonly?: boolean;
  name: string;
  required: boolean;
  type: string;
  reference: string | null;
  options: string[] | null;
};
export type Entity = {
  name: string;
  label: string;
  readonly: boolean;
  fields: Field[];
  auditFields: string[];
  permissions: Record<string, boolean>;
};
export type User = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  permissions: Record<string, Record<string, boolean>>;
};
export type Colors = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
};
export type Logo = {
  id: string;
  objectId: string;
  name: string;
  mime_type: string;
  data_base64: string;
};
export type Design = {
  id: string | null;
  objectId: string | null;
  colors: Colors;
  logo: Logo | null;
};
