// Build regular ES imports and keep optional feature chunks separate from shared dependencies.
import {defineConfig} from 'vite';
export default defineConfig({
  build:{outDir:'dist',target:'es2022',rolldownOptions:{output:{codeSplitting:{includeDependenciesRecursively:false,
    groups:[
      {name:'reports',test:/\/src\/features\/reports\.js$/,priority:30},
      {name:'report-export',test:/\/src\/features\/reportCharts\.js$/,priority:30},
      {name:'camera',test:/\/src\/features\/camera\.js$/,priority:30},
      {name:'supabase',test:/node_modules\/@supabase/,priority:20},
      {name:'features',test:/\/src\/features\//,maxSize:220000,minSize:10000},
      {name:'domain',test:/\/src\/(domain|services|shared|ui)\//,maxSize:100000}
    ]
  }}}}
});
