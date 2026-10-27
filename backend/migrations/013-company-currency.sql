-- Company currency is explicit; historical rows inherit the existing Fund currency in the KPI engine.
ALTER TABLE portal.companies ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE portal.companies ADD CONSTRAINT companies_currency_iso3 CHECK(currency IS NULL OR currency ~ '^[A-Z]{3}$');
