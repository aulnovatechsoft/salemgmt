import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Linking, Dimensions, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { User, Mail, Phone, Search, X, ChevronLeft, ChevronDown, ChevronUp, Users, RefreshCw, AlertCircle } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import React from "react";

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const useDebounce = <T,>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

type HierarchyNode = {
  id: string;
  persNo: string;
  name: string;
  designation: string | null;
  circle: string | null;
  zone: string | null;
  division: string | null;
  officeName: string | null;
  sortOrder: number | null;
  reportingPersNo: string | null;
  isLinked: boolean | null;
  linkedEmployee: {
    id: string;
    email: string;
    phone: string;
    role: string;
  } | null;
  directReportsCount?: number;
  children?: HierarchyNode[];
};

const getInitials = (name: string) => {
  const parts = name.split(' ').filter(p => p.length > 0);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

const getAvatarColor = (name: string) => {
  const colors = ['#1976D2', '#388E3C', '#D32F2F', '#7B1FA2', '#F57C00', '#0097A7', '#5D4037', '#455A64'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

const getLevelLabel = (level: number) => {
  if (level < 0) return `L${level}`;
  if (level === 0) return 'YOU';
  return `L+${level}`;
};

const getLevelColor = (level: number) => {
  if (level < 0) return '#FFA726';
  if (level === 0) return Colors.light.primary;
  return '#66BB6A';
};

const OrgChartNode = ({
  node,
  level,
  isCurrentUser = false,
  isExpanded = false,
  onToggle,
  isLast = false,
  showLine = true,
}: {
  node: HierarchyNode;
  level: number;
  isCurrentUser?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  isLast?: boolean;
  showLine?: boolean;
}) => {
  const handleCall = () => {
    if (node.linkedEmployee?.phone) {
      Linking.openURL(`tel:${node.linkedEmployee.phone}`);
    }
  };

  const handleEmail = () => {
    if (node.linkedEmployee?.email) {
      Linking.openURL(`mailto:${node.linkedEmployee.email}`);
    }
  };

  const hasChildren = (node.directReportsCount ?? 0) > 0 || (node.children && node.children.length > 0);
  const childCount = node.directReportsCount || node.children?.length || 0;

  return (
    <View style={styles.nodeContainer}>
      {showLine && level !== 0 && (
        <View style={[
          styles.verticalLine,
          { height: isLast ? 40 : '100%' }
        ]} />
      )}
      
      {level !== 0 && (
        <View style={styles.horizontalLine} />
      )}
      
      <View style={[
        styles.nodeCard,
        isCurrentUser && styles.nodeCardCurrent,
        level < 0 && styles.nodeCardManager,
      ]}>
        <View style={styles.levelBadge}>
          <View style={[styles.levelPill, { backgroundColor: getLevelColor(level) }]}>
            <Text style={styles.levelText}>{getLevelLabel(level)}</Text>
          </View>
        </View>
        
        <View style={styles.nodeContent}>
          <View style={[styles.nodeAvatar, { backgroundColor: getAvatarColor(node.name) }]}>
            <Text style={styles.nodeAvatarText}>{getInitials(node.name)}</Text>
          </View>
          
          <View style={styles.nodeInfo}>
            <Text style={styles.nodeName} numberOfLines={1}>{node.name}</Text>
            <Text style={styles.nodeDesignation}>{node.designation || 'N/A'}</Text>
            <Text style={styles.nodeMeta}>{node.circle}</Text>
            <View style={styles.statusRow}>
              {node.isLinked ? (
                <View style={styles.registeredBadge}>
                  <View style={styles.statusDotSmall} />
                  <Text style={styles.registeredText}>Registered</Text>
                </View>
              ) : (
                <View style={styles.notRegisteredBadge}>
                  <Text style={styles.notRegisteredText}>Not Registered</Text>
                </View>
              )}
            </View>
          </View>
          
          <View style={styles.nodeActions}>
            {node.isLinked && node.linkedEmployee && (
              <View style={styles.contactActions}>
                <TouchableOpacity style={styles.contactBtn} onPress={handleCall}>
                  <Phone size={14} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.contactBtn} onPress={handleEmail}>
                  <Mail size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
        
        {hasChildren && onToggle && (
          <TouchableOpacity style={styles.expandButton} onPress={onToggle}>
            <View style={styles.expandContent}>
              {isExpanded ? (
                <ChevronUp size={16} color={Colors.light.primary} />
              ) : (
                <ChevronDown size={16} color={Colors.light.primary} />
              )}
              <Text style={styles.expandText}>{childCount} reports</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const TreeConnector = ({ type }: { type: 'down' | 'up' }) => (
  <View style={styles.treeConnector}>
    <View style={styles.connectorVertical} />
    {type === 'down' ? (
      <ChevronDown size={16} color={Colors.light.border} />
    ) : (
      <ChevronUp size={16} color={Colors.light.border} />
    )}
  </View>
);

export default function HierarchyScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const { 
    data: hierarchy, 
    isLoading: hierarchyLoading, 
    refetch: refetchHierarchy,
  } = trpc.admin.getMyHierarchy.useQuery(
    { employeeId: employee?.id || '' },
    { enabled: !!employee?.id, retry: 2 }
  );

  const userPurseId = hierarchy?.masterData?.persNo;
  const isLinked = hierarchy?.isLinked;

  const { 
    data: fullHierarchy, 
    isLoading: fullHierarchyLoading, 
    refetch: refetchFullHierarchy,
    isError: isHierarchyError,
    error: hierarchyError,
  } = trpc.admin.getFullHierarchy.useQuery(
    { persNo: userPurseId || '' },
    { enabled: !!userPurseId && isLinked, retry: 2, staleTime: 30000 }
  );

  const { 
    data: searchResults, 
    isLoading: searchLoading,
    isFetching: isSearchFetching,
  } = trpc.admin.searchHierarchy.useQuery(
    { persNo: userPurseId || '', searchQuery: debouncedSearchQuery },
    { enabled: !!userPurseId && debouncedSearchQuery.length >= 2, retry: 1 }
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchHierarchy(), refetchFullHierarchy()]);
    setRefreshing(false);
  }, [refetchHierarchy, refetchFullHierarchy]);

  const toggleExpand = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const renderSubordinates = (subordinates: HierarchyNode[], baseLevel: number = 1, depth: number = 0): React.ReactNode => {
    if (depth >= 2) return null;
    
    return subordinates.map((sub, index) => {
      const isExpanded = expandedNodes.has(sub.id);
      const hasChildren = sub.children && sub.children.length > 0;
      const isLast = index === subordinates.length - 1;
      
      return (
        <View key={sub.id} style={[styles.subordinateRow, { marginLeft: depth * 20 }]}>
          <OrgChartNode
            node={sub}
            level={baseLevel + depth}
            isExpanded={isExpanded}
            onToggle={hasChildren ? () => toggleExpand(sub.id) : undefined}
            isLast={isLast}
            showLine={depth > 0}
          />
          {isExpanded && hasChildren && (
            <View style={styles.childrenContainer}>
              {renderSubordinates(sub.children!, baseLevel, depth + 1)}
            </View>
          )}
        </View>
      );
    });
  };

  if (!employee) return null;

  const isLoading = hierarchyLoading || fullHierarchyLoading;
  const managers = fullHierarchy?.managers?.slice(-2) || [];
  const reversedManagers = [...managers].reverse();

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Organization Hierarchy',
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
          headerTitleStyle: { fontWeight: 'bold' as const },
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 16 }}>
              <ChevronLeft size={24} color={Colors.light.background} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity onPress={() => setShowSearch(!showSearch)} style={{ marginRight: 8 }}>
              <Search size={22} color={Colors.light.background} />
            </TouchableOpacity>
          ),
        }} 
      />
      
      <ScrollView 
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.light.primary]} />
        }
      >
        {showSearch && (
          <View style={styles.searchBar}>
            <Search size={18} color={Colors.light.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name or Pers No..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholderTextColor={Colors.light.textSecondary}
              autoFocus
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <X size={18} color={Colors.light.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}
        
        {!isLinked ? (
          <View style={styles.notLinkedContainer}>
            <Users size={64} color={Colors.light.textSecondary} />
            <Text style={styles.notLinkedTitle}>Account Not Linked</Text>
            <Text style={styles.notLinkedText}>
              Link your account to your Employee Pers No to view your organization hierarchy.
            </Text>
          </View>
        ) : debouncedSearchQuery.length >= 2 ? (
          <View style={styles.searchResultsContainer}>
            <Text style={styles.sectionTitle}>
              Search Results {!isSearchFetching && `(${searchResults?.length || 0})`}
            </Text>
            {searchLoading || isSearchFetching ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator color={Colors.light.primary} />
                <Text style={styles.loadingText}>Searching...</Text>
              </View>
            ) : searchResults?.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Search size={32} color={Colors.light.textSecondary} />
                <Text style={styles.emptyText}>No results for "{debouncedSearchQuery}"</Text>
              </View>
            ) : (
              searchResults?.map((result: any) => (
                <OrgChartNode key={result.id} node={result} level={0} />
              ))
            )}
          </View>
        ) : isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>Loading your org chart...</Text>
          </View>
        ) : isHierarchyError ? (
          <View style={styles.errorContainer}>
            <AlertCircle size={48} color={Colors.light.error} />
            <Text style={styles.errorTitle}>Unable to Load</Text>
            <Text style={styles.errorText}>{hierarchyError?.message || 'Please check your connection'}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetchFullHierarchy()}>
              <RefreshCw size={16} color="#fff" />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.orgChart}>
            <View style={styles.chartHeader}>
              <Text style={styles.chartTitle}>Your Organization</Text>
              <Text style={styles.chartSubtitle}>
                {managers.length > 0 ? `${managers.length} level${managers.length > 1 ? 's' : ''} up` : 'No managers'} 
                {' • '}
                {fullHierarchy?.subordinates?.length || 0} direct reports
              </Text>
            </View>
            
            {reversedManagers.length > 0 && (
              <View style={styles.managersSection}>
                <View style={styles.sectionHeader}>
                  <ChevronUp size={16} color="#FFA726" />
                  <Text style={styles.sectionLabel}>Reporting To</Text>
                </View>
                {reversedManagers.map((manager, index) => (
                  <OrgChartNode
                    key={manager.id}
                    node={manager}
                    level={-(reversedManagers.length - index)}
                    showLine={index > 0}
                  />
                ))}
                <TreeConnector type="down" />
              </View>
            )}
            
            {fullHierarchy?.currentUser && (
              <View style={styles.currentUserSection}>
                <OrgChartNode
                  node={fullHierarchy.currentUser}
                  level={0}
                  isCurrentUser={true}
                  showLine={false}
                />
              </View>
            )}
            
            {fullHierarchy?.subordinates && fullHierarchy.subordinates.length > 0 && (
              <View style={styles.subordinatesSection}>
                <TreeConnector type="down" />
                <View style={styles.sectionHeader}>
                  <ChevronDown size={16} color="#66BB6A" />
                  <Text style={styles.sectionLabel}>Your Team</Text>
                </View>
                {renderSubordinates(fullHierarchy.subordinates)}
              </View>
            )}
            
            {(!fullHierarchy?.subordinates || fullHierarchy.subordinates.length === 0) && (
              <View style={styles.noTeamSection}>
                <Users size={32} color={Colors.light.textSecondary} />
                <Text style={styles.noTeamText}>No direct reports</Text>
              </View>
            )}
          </View>
        )}
        
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  contentContainer: {
    paddingVertical: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
  },
  notLinkedContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
    gap: 16,
  },
  notLinkedTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.light.text,
  },
  notLinkedText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  searchResultsContainer: {
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 64,
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 48,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  errorContainer: {
    alignItems: 'center',
    padding: 48,
    gap: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
  },
  errorText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
    marginTop: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },
  orgChart: {
    paddingHorizontal: 16,
  },
  chartHeader: {
    marginBottom: 24,
  },
  chartTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.light.text,
  },
  chartSubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 4,
  },
  managersSection: {
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingLeft: 4,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  currentUserSection: {
    marginVertical: 8,
  },
  subordinatesSection: {
    marginTop: 8,
  },
  noTeamSection: {
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  noTeamText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  nodeContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  verticalLine: {
    position: 'absolute',
    left: 20,
    top: -8,
    width: 2,
    backgroundColor: '#E0E0E0',
  },
  horizontalLine: {
    position: 'absolute',
    left: 20,
    top: 32,
    width: 16,
    height: 2,
    backgroundColor: '#E0E0E0',
  },
  nodeCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  nodeCardCurrent: {
    borderColor: Colors.light.primary,
    borderWidth: 2,
    backgroundColor: '#E3F2FD',
    shadowColor: Colors.light.primary,
    shadowOpacity: 0.25,
  },
  nodeCardManager: {
    backgroundColor: '#FFF8E1',
    borderLeftWidth: 3,
    borderLeftColor: '#FFA726',
  },
  levelBadge: {
    position: 'absolute',
    top: -8,
    right: 12,
  },
  levelPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  levelText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#fff',
  },
  nodeContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nodeAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  nodeAvatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  nodeInfo: {
    flex: 1,
  },
  nodeName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 1,
  },
  nodeDesignation: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 1,
  },
  nodeMeta: {
    fontSize: 11,
    color: Colors.light.textSecondary,
  },
  nodeActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  nodeStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  registeredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  statusDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4CAF50',
  },
  registeredText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#2E7D32',
  },
  notRegisteredBadge: {
    backgroundColor: '#ECEFF1',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  notRegisteredText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#607D8B',
  },
  contactActions: {
    flexDirection: 'row',
    gap: 6,
  },
  contactBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  expandButton: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    alignItems: 'center',
  },
  expandContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  expandText: {
    fontSize: 13,
    color: Colors.light.primary,
    fontWeight: '500',
  },
  treeConnector: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  connectorVertical: {
    width: 2,
    height: 16,
    backgroundColor: '#E0E0E0',
  },
  subordinateRow: {
    marginBottom: 4,
  },
  childrenContainer: {
    marginTop: 4,
  },
  bottomSpacer: {
    height: 40,
  },
});
