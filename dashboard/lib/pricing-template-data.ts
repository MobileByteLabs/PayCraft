export interface CountryBand {
  country: string     // ISO 3166-1 alpha-2
  currency: string    // ISO 4217
  multiplier: number  // relative to USD reference price
  roundTo: number     // round final minor-unit amount to nearest N
}

export const DEFAULT_BANDS: CountryBand[] = [
  { country: "US", currency: "USD", multiplier: 1.00,    roundTo: 99 },
  { country: "GB", currency: "GBP", multiplier: 0.80,    roundTo: 99 },
  { country: "DE", currency: "EUR", multiplier: 0.92,    roundTo: 99 },
  { country: "FR", currency: "EUR", multiplier: 0.92,    roundTo: 99 },
  { country: "ES", currency: "EUR", multiplier: 0.92,    roundTo: 99 },
  { country: "IT", currency: "EUR", multiplier: 0.92,    roundTo: 99 },
  { country: "AU", currency: "AUD", multiplier: 0.90,    roundTo: 99 },
  { country: "CA", currency: "CAD", multiplier: 0.90,    roundTo: 99 },
  { country: "JP", currency: "JPY", multiplier: 110.0,   roundTo: 100 },
  { country: "KR", currency: "KRW", multiplier: 1300.0,  roundTo: 1000 },
  { country: "CN", currency: "CNY", multiplier: 7.20,    roundTo: 99 },
  { country: "TW", currency: "TWD", multiplier: 15.0,    roundTo: 99 },
  { country: "IN", currency: "INR", multiplier: 30.0,    roundTo: 99 },
  { country: "PK", currency: "PKR", multiplier: 100.0,   roundTo: 99 },
  { country: "BD", currency: "BDT", multiplier: 30.0,    roundTo: 99 },
  { country: "BR", currency: "BRL", multiplier: 3.20,    roundTo: 99 },
  { country: "MX", currency: "MXN", multiplier: 17.0,    roundTo: 99 },
  { country: "AR", currency: "ARS", multiplier: 350.0,   roundTo: 100 },
  { country: "CL", currency: "CLP", multiplier: 750.0,   roundTo: 990 },
  { country: "CO", currency: "COP", multiplier: 3000.0,  roundTo: 990 },
  { country: "ZA", currency: "ZAR", multiplier: 5.50,    roundTo: 99 },
  { country: "NG", currency: "NGN", multiplier: 700.0,   roundTo: 99 },
  { country: "EG", currency: "EGP", multiplier: 25.0,    roundTo: 99 },
  { country: "ID", currency: "IDR", multiplier: 9000.0,  roundTo: 99 },
  { country: "PH", currency: "PHP", multiplier: 28.0,    roundTo: 99 },
  { country: "VN", currency: "VND", multiplier: 14000.0, roundTo: 990 },
  { country: "TH", currency: "THB", multiplier: 18.0,    roundTo: 99 },
  { country: "TR", currency: "TRY", multiplier: 14.0,    roundTo: 99 },
  { country: "RU", currency: "RUB", multiplier: 50.0,    roundTo: 99 },
  { country: "PL", currency: "PLN", multiplier: 2.20,    roundTo: 99 },
  { country: "SA", currency: "SAR", multiplier: 1.80,    roundTo: 99 },
  { country: "AE", currency: "AED", multiplier: 1.80,    roundTo: 99 },
]

export const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY", "KRW", "VND", "CLP", "COP", "IDR",
])
