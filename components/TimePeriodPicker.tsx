import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  TextInput,
  Platform,
} from 'react-native';
import { Calendar, ChevronDown, X, Check } from 'lucide-react-native';
import Colors from '@/constants/colors';
import {
  PERIOD_OPTIONS,
  PeriodKey,
  PeriodRange,
  computePeriodRange,
  istTodayYmd,
} from '@/utils/timePeriod';

interface Props {
  value: PeriodRange;
  onChange: (range: PeriodRange) => void;
}

const GROUP_TITLES: Record<string, string> = {
  quick: 'Quick',
  calendar: 'Calendar',
  financial: 'Financial Year (India)',
  custom: 'Custom',
};

export default function TimePeriodPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState(value.key === 'custom' ? value.startDate : '');
  const [customEnd, setCustomEnd] = useState(value.key === 'custom' ? value.endDate : '');
  const [customError, setCustomError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const g: Record<string, typeof PERIOD_OPTIONS> = { quick: [], calendar: [], financial: [], custom: [] };
    PERIOD_OPTIONS.forEach((o) => g[o.group].push(o));
    return g;
  }, []);

  const labelText = useMemo(() => {
    const opt = PERIOD_OPTIONS.find((o) => o.key === value.key);
    if (value.key === 'custom') return `${value.startDate} → ${value.endDate}`;
    return opt?.label || 'Select Period';
  }, [value]);

  const subText = useMemo(() => {
    if (value.startDate === value.endDate) return value.startDate;
    return `${value.startDate} → ${value.endDate}`;
  }, [value]);

  const todayYmd = useMemo(() => istTodayYmd(), []);

  const handleSelect = (key: PeriodKey) => {
    if (key === 'custom') {
      const today = todayYmd;
      const monthStart = `${today.slice(0, 7)}-01`;
      const initStart = customStart || monthStart;
      const initEnd = customEnd || today;
      setCustomStart(initStart);
      setCustomEnd(initEnd);
      setCustomError(null);
      return;
    }
    const range = computePeriodRange(key);
    onChange(range);
    setOpen(false);
  };

  const isRealYmd = (s: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  };

  const validateAndApplyCustom = () => {
    if (!isRealYmd(customStart) || !isRealYmd(customEnd)) {
      setCustomError('Use a valid YYYY-MM-DD date');
      return;
    }
    if (customStart > customEnd) {
      setCustomError('Start date must be on or before end date');
      return;
    }
    if (customEnd > todayYmd) {
      setCustomError('End date cannot be in the future');
      return;
    }
    const [sy, sm, sd] = customStart.split('-').map(Number);
    const [ey, em, ed] = customEnd.split('-').map(Number);
    const sUtc = Date.UTC(sy, sm - 1, sd);
    const eUtc = Date.UTC(ey, em - 1, ed);
    const diffDays = Math.floor((eUtc - sUtc) / 86400000) + 1;
    if (diffDays > 730) {
      setCustomError('Range cannot exceed 730 days');
      return;
    }
    setCustomError(null);
    onChange(computePeriodRange('custom', customStart, customEnd));
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Calendar size={16} color={Colors.light.primary} />
        <View style={styles.triggerLabels}>
          <Text style={styles.triggerLabel} numberOfLines={1}>{labelText}</Text>
          {value.key !== 'custom' && (
            <Text style={styles.triggerSub} numberOfLines={1}>{subText}</Text>
          )}
        </View>
        <ChevronDown size={16} color={Colors.light.textSecondary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setOpen(false)} accessible={false}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>
        <View style={styles.sheetWrapper} pointerEvents="box-none">
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select Time Period</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10}>
                <X size={22} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.sheetBody} contentContainerStyle={{ paddingBottom: 24 }}>
              {(['quick', 'calendar', 'financial', 'custom'] as const).map((g) => (
                <View key={g} style={styles.group}>
                  <Text style={styles.groupTitle}>{GROUP_TITLES[g]}</Text>
                  {grouped[g].map((opt) => {
                    const isSelected = value.key === opt.key;
                    if (opt.key === 'custom') {
                      return (
                        <View key={opt.key}>
                          <TouchableOpacity
                            style={[styles.optionRow, isSelected && styles.optionRowActive]}
                            onPress={() => handleSelect(opt.key)}
                            activeOpacity={0.7}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.optionLabel, isSelected && styles.optionLabelActive]}>
                                {opt.label}
                              </Text>
                              {opt.description && (
                                <Text style={styles.optionDesc}>{opt.description}</Text>
                              )}
                            </View>
                            {isSelected && <Check size={18} color={Colors.light.primary} />}
                          </TouchableOpacity>
                          <View style={styles.customBox}>
                            <View style={styles.customRow}>
                              <View style={styles.customField}>
                                <Text style={styles.customLabel}>From</Text>
                                <TextInput
                                  style={styles.customInput}
                                  value={customStart}
                                  onChangeText={setCustomStart}
                                  placeholder="YYYY-MM-DD"
                                  placeholderTextColor={Colors.light.textSecondary}
                                  autoCapitalize="none"
                                  autoCorrect={false}
                                  {...dateInputWebProps(todayYmd)}
                                />
                              </View>
                              <View style={styles.customField}>
                                <Text style={styles.customLabel}>To</Text>
                                <TextInput
                                  style={styles.customInput}
                                  value={customEnd}
                                  onChangeText={setCustomEnd}
                                  placeholder="YYYY-MM-DD"
                                  placeholderTextColor={Colors.light.textSecondary}
                                  autoCapitalize="none"
                                  autoCorrect={false}
                                  {...dateInputWebProps(todayYmd)}
                                />
                              </View>
                            </View>
                            {customError && <Text style={styles.customErr}>{customError}</Text>}
                            <TouchableOpacity style={styles.applyBtn} onPress={validateAndApplyCustom}>
                              <Text style={styles.applyBtnText}>Apply Custom Range</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    }
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        style={[styles.optionRow, isSelected && styles.optionRowActive]}
                        onPress={() => handleSelect(opt.key)}
                        activeOpacity={0.7}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.optionLabel, isSelected && styles.optionLabelActive]}>
                            {opt.label}
                          </Text>
                          {opt.description && (
                            <Text style={styles.optionDesc}>{opt.description}</Text>
                          )}
                        </View>
                        {isSelected && <Check size={18} color={Colors.light.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const dateInputWebProps = (max?: string) =>
  Platform.OS === 'web' ? ({ type: 'date', max } as any) : { keyboardType: 'numbers-and-punctuation' as const };

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  triggerLabels: { flex: 1 },
  triggerLabel: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  triggerSub: { fontSize: 11, color: Colors.light.textSecondary, marginTop: 2 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheetWrapper: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '85%',
    minHeight: 480,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: Colors.light.text },
  sheetBody: { paddingHorizontal: 16, paddingTop: 8 },
  group: { marginTop: 16 },
  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.light.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Colors.light.background,
    marginBottom: 6,
  },
  optionRowActive: { backgroundColor: '#E3F2FD' },
  optionLabel: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  optionLabelActive: { color: Colors.light.primary },
  optionDesc: { fontSize: 11, color: Colors.light.textSecondary, marginTop: 2 },
  customBox: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  customRow: { flexDirection: 'row', gap: 12 },
  customField: { flex: 1 },
  customLabel: { fontSize: 11, color: Colors.light.textSecondary, marginBottom: 4 },
  customInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'web' ? 8 : 10,
    fontSize: 14,
    color: Colors.light.text,
  },
  customErr: { fontSize: 12, color: '#D32F2F', marginTop: 8 },
  applyBtn: {
    marginTop: 12,
    backgroundColor: Colors.light.primary,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  applyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
