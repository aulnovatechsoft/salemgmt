export const CIRCLE_ENUM_VALUES = [
  'ANDAMAN_NICOBAR',
  'ANDHRA_PRADESH',
  'ASSAM',
  'BIHAR',
  'CHHATTISGARH',
  'GUJARAT',
  'HARYANA',
  'HIMACHAL_PRADESH',
  'JAMMU_KASHMIR',
  'JHARKHAND',
  'KARNATAKA',
  'KERALA',
  'MADHYA_PRADESH',
  'MAHARASHTRA',
  'NORTH_EAST_I',
  'NORTH_EAST_II',
  'ODISHA',
  'PUNJAB',
  'RAJASTHAN',
  'TAMIL_NADU',
  'TELANGANA',
  'UTTARAKHAND',
  'UTTAR_PRADESH_EAST',
  'UTTAR_PRADESH_WEST',
  'WEST_BENGAL',
] as const;

export type CircleEnum = typeof CIRCLE_ENUM_VALUES[number];

const CIRCLE_NAME_TO_ENUM: Record<string, CircleEnum> = {
  'andaman & nicobar': 'ANDAMAN_NICOBAR',
  'andaman and nicobar': 'ANDAMAN_NICOBAR',
  'andaman nicobar': 'ANDAMAN_NICOBAR',
  'andaman & nicobar telecom circ': 'ANDAMAN_NICOBAR',
  'andhra pradesh': 'ANDHRA_PRADESH',
  'andhra pradesh telecom circle': 'ANDHRA_PRADESH',
  'assam': 'ASSAM',
  'assam telecom circle': 'ASSAM',
  'bihar': 'BIHAR',
  'bihar telecom circle': 'BIHAR',
  'chhattisgarh': 'CHHATTISGARH',
  'chhattisgarh telecom circle': 'CHHATTISGARH',
  'gujarat': 'GUJARAT',
  'gujarat telecom circle': 'GUJARAT',
  'haryana': 'HARYANA',
  'haryana telecom circle': 'HARYANA',
  'himachal pradesh': 'HIMACHAL_PRADESH',
  'himachal pradesh telecom circl': 'HIMACHAL_PRADESH',
  'himachal pradesh telecom circle': 'HIMACHAL_PRADESH',
  'jammu kashmir': 'JAMMU_KASHMIR',
  'jammu & kashmir': 'JAMMU_KASHMIR',
  'jammu and kashmir': 'JAMMU_KASHMIR',
  'jammu kashmir telecom circle': 'JAMMU_KASHMIR',
  'jammu & kashmir telecom circle': 'JAMMU_KASHMIR',
  'jharkhand': 'JHARKHAND',
  'jharkhand telecom circle': 'JHARKHAND',
  'jharkand telecom circle': 'JHARKHAND',
  'karnataka': 'KARNATAKA',
  'karnataka telecom circle': 'KARNATAKA',
  'kerala': 'KERALA',
  'kerala telecom circle': 'KERALA',
  'madhya pradesh': 'MADHYA_PRADESH',
  'madhya pradesh telecom circle': 'MADHYA_PRADESH',
  'maharashtra': 'MAHARASHTRA',
  'maharashtra telecom circle': 'MAHARASHTRA',
  'north east i': 'NORTH_EAST_I',
  'north east 1': 'NORTH_EAST_I',
  'north east - i telecom circle': 'NORTH_EAST_I',
  'north east ii': 'NORTH_EAST_II',
  'north east 2': 'NORTH_EAST_II',
  'north east - ii telecom circle': 'NORTH_EAST_II',
  'odisha': 'ODISHA',
  'odisha telecom circle': 'ODISHA',
  'orissa': 'ODISHA',
  'punjab': 'PUNJAB',
  'punjab telecom circle': 'PUNJAB',
  'rajasthan': 'RAJASTHAN',
  'rajasthan telecom circle': 'RAJASTHAN',
  'tamil nadu': 'TAMIL_NADU',
  'tamil nadu telecom circle': 'TAMIL_NADU',
  'tamil nadu circle': 'TAMIL_NADU',
  'telangana': 'TELANGANA',
  'telangana telecom circle': 'TELANGANA',
  'uttarakhand': 'UTTARAKHAND',
  'uttarakhand telecom circle': 'UTTARAKHAND',
  'uttaranchal telecom circle': 'UTTARAKHAND',
  'uttaranchal': 'UTTARAKHAND',
  'uttar pradesh east': 'UTTAR_PRADESH_EAST',
  'uttar pradesh (east)': 'UTTAR_PRADESH_EAST',
  'up east': 'UTTAR_PRADESH_EAST',
  'up (e) telecom circle': 'UTTAR_PRADESH_EAST',
  'uttar pradesh west': 'UTTAR_PRADESH_WEST',
  'uttar pradesh (west)': 'UTTAR_PRADESH_WEST',
  'up west': 'UTTAR_PRADESH_WEST',
  'up (w) telecom circle': 'UTTAR_PRADESH_WEST',
  'west bengal': 'WEST_BENGAL',
  'west bengal telecom circle': 'WEST_BENGAL',
  'calcutta metro district': 'WEST_BENGAL',
  'calcutta': 'WEST_BENGAL',
  'kolkata': 'WEST_BENGAL',
  'sikkim': 'NORTH_EAST_I',
  'sikkim telecom circle': 'NORTH_EAST_I',
  'chennai metro district': 'TAMIL_NADU',
  'chennai': 'TAMIL_NADU',
  'core network(tx-east)  kolkatt': 'WEST_BENGAL',
  'core network(tx-ne region) ght': 'NORTH_EAST_I',
  'core network(tx-north)  delhi': 'UTTAR_PRADESH_WEST',
  'core network(tx-south) chennai': 'TAMIL_NADU',
  'core network(tx-west) mumbai': 'MAHARASHTRA',
  'corporate office': 'KARNATAKA',
  'alttc': 'KARNATAKA',
  'bbnw circle': 'KARNATAKA',
  'inspections': 'KARNATAKA',
  'itpc pune': 'MAHARASHTRA',
  'mtnl': 'MAHARASHTRA',
  'network for spectrum circle': 'KARNATAKA',
  'outside bsnl': 'KARNATAKA',
  'telecom factory jabalpur': 'MADHYA_PRADESH',
  'telecom factory kolkata': 'WEST_BENGAL',
  'telecom factory mumbai': 'MAHARASHTRA',
};

export function mapCircleNameToEnum(circleName: string | null | undefined): CircleEnum {
  if (!circleName) return 'KARNATAKA';
  
  const normalized = circleName.toLowerCase().trim();
  
  if (CIRCLE_NAME_TO_ENUM[normalized]) {
    return CIRCLE_NAME_TO_ENUM[normalized];
  }
  
  const upperNormalized = circleName.toUpperCase().replace(/[\s-]+/g, '_').replace(/[()]/g, '');
  if (CIRCLE_ENUM_VALUES.includes(upperNormalized as CircleEnum)) {
    return upperNormalized as CircleEnum;
  }
  
  for (const [key, value] of Object.entries(CIRCLE_NAME_TO_ENUM)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }
  
  return 'KARNATAKA';
}

export function isValidCircleEnum(value: string): value is CircleEnum {
  return CIRCLE_ENUM_VALUES.includes(value as CircleEnum);
}
