/**
 * Department Filter Component
 *
 * Filter buttons for agent departments.
 */

import React from 'react';
import type { AgentDepartment, AgentWithStatus } from '../../types/agent';
import { Brain, TrendingUp, Code, FileText, Target, LayoutGrid } from 'lucide-react';

interface DepartmentFilterProps {
  selected: AgentDepartment | 'All';
  onSelect: (dept: AgentDepartment | 'All') => void;
  departments: Record<AgentDepartment, AgentWithStatus[]>;
}

const departmentIcons: Record<AgentDepartment | 'All', React.ComponentType<{ className?: string }>> = {
  All: LayoutGrid,
  Executive: Brain,
  Research: TrendingUp,
  Development: Code,
  Content: FileText,
  Sales: Target,
};

const departmentLabels: Record<AgentDepartment | 'All', string> = {
  All: 'All',
  Executive: 'Executive',
  Research: 'Research',
  Development: 'Development',
  Content: 'Content',
  Sales: 'Sales',
};

export function DepartmentFilter({ selected, onSelect, departments }: DepartmentFilterProps) {
  const allDepartments: (AgentDepartment | 'All')[] = ['All', 'Executive', 'Research', 'Development', 'Content', 'Sales'];

  return (
    <div className="flex flex-wrap gap-2">
      {allDepartments.map(dept => {
        const Icon = departmentIcons[dept];
        const count = dept === 'All'
          ? Object.values(departments).reduce((sum, agents) => sum + agents.length, 0)
          : departments[dept].length;
        const isSelected = selected === dept;

        return (
          <button
            key={dept}
            onClick={() => onSelect(dept)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              isSelected
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            <Icon className="w-4 h-4" />
            {departmentLabels[dept]}
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
              isSelected ? 'bg-primary-foreground text-primary' : 'bg-secondary-foreground text-secondary'
            }`}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
