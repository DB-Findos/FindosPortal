import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  BookOpen,
  ContactRound,
  UsersRound,
  Calculator,
  Plane,
  LayoutGrid,
  FileSignature,
  MessagesSquare,
  Database,
  Handshake,
  WalletCards,
  Landmark,
} from 'lucide-react';
const icons = {
  reporting: BarChart3,
  'portfolio-management': BriefcaseBusiness,
  crm: ContactRound,
  'knowledge-management': BookOpen,
  'entity-management': Building2,
  'people-management': UsersRound,
  datev: Calculator,
  'lanes-planes': Plane,
  'adobe-sign': FileSignature,
  teams: MessagesSquare,
  dynamo: Database,
  'deal-management': Handshake,
  'fund-management': WalletCards,
  'financing-tools': Landmark,
};
export default function ApplicationIcon({
  application,
  size = 25,
}: {
  application: string;
  size?: number;
}) {
  const Icon = icons[application as keyof typeof icons] ?? LayoutGrid;
  return <Icon size={size} aria-hidden="true" />;
}
