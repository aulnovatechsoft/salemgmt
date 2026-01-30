export const safeNumber = (amount: string | number | null | undefined): number => {
  if (amount === null || amount === undefined) return 0;
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return isNaN(num) ? 0 : num;
};

export const formatINRAmount = (amount: string | number | null | undefined): string => {
  const num = safeNumber(amount);
  if (num <= 0) return '₹0';
  return '₹' + num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

export const formatINRCrore = (amount: string | number | null | undefined): string => {
  const num = safeNumber(amount);
  if (num <= 0) return '₹0';
  const crores = num / 10000000;
  if (crores >= 1) {
    return '₹' + crores.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Cr';
  }
  const lakhs = num / 100000;
  if (lakhs >= 1) {
    return '₹' + lakhs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' L';
  }
  return '₹' + num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

export const formatINRCompact = (amount: string | number | null | undefined): string => {
  const num = safeNumber(amount);
  if (num <= 0) return '₹0';
  
  if (num >= 10000000) {
    const crores = num / 10000000;
    return '₹' + crores.toFixed(2) + 'Cr';
  }
  if (num >= 100000) {
    const lakhs = num / 100000;
    return '₹' + lakhs.toFixed(2) + 'L';
  }
  if (num >= 1000) {
    const thousands = num / 1000;
    return '₹' + thousands.toFixed(1) + 'K';
  }
  return '₹' + num.toFixed(0);
};

export const hasOutstandingAmount = (ftth: string | number | null | undefined, lc: string | number | null | undefined): boolean => {
  return safeNumber(ftth) > 0 || safeNumber(lc) > 0;
};

export const getTotalOutstanding = (ftth: string | number | null | undefined, lc: string | number | null | undefined): number => {
  return safeNumber(ftth) + safeNumber(lc);
};
