import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {filterOperatorSchema,filterValueSchema,type FilterGroup,type FilterNode,type FilterValue,type FilterOperator,type ReportViewPatch,MAX_FILTER_CONDITIONS,MAX_FILTER_DEPTH} from './types';
type Primitive=string|number|boolean;
type Condition={field:string;operator:FilterOperator;value?:FilterValue|Primitive|Primitive[];negated?:boolean};
type Group={combinator:'and'|'or';negated?:boolean;children:Node[]};
type Node=Condition|Group;
const primitive=z.union([z.string().max(500),z.number().finite(),z.boolean()]);
const condition=z.object({field:z.string().min(1).max(80),operator:filterOperatorSchema,value:z.union([filterValueSchema,primitive,z.array(primitive).min(1).max(100)]).optional(),negated:z.boolean().optional()}).strict();
const group:z.ZodType<Group>=z.lazy(()=>z.object({combinator:z.enum(['and','or']),negated:z.boolean().optional(),children:z.array(z.union([condition,group])).max(MAX_FILTER_CONDITIONS*2)}).strict());
export const configureTableSchema=z.object({
 expectedRevision:z.number().int().nonnegative().nullable(),
 filters:group.optional(),
 columns:z.array(z.string().min(1).max(80)).min(1).max(64).optional(),
 sort:z.array(z.object({field:z.string().min(1).max(80),direction:z.enum(['asc','desc'])}).strict()).max(5).optional(),
 groupBy:z.array(z.object({field:z.string().min(1).max(80),direction:z.enum(['asc','desc']),hideEmpty:z.boolean().optional()}).strict()).max(1).optional(),
}).strict();
export type ConfigureTableInput=z.infer<typeof configureTableSchema>;
/** IDs belong to the server. The immutable tenant guard stays outside all user OR/NOT groups. */
export function compileSemanticView(input:ConfigureTableInput,farmId:string,fieldType:(field:string)=>string=()=> 'text'):ReportViewPatch {
 let count=0;
 function node(n:Node,depth:number):FilterNode {
  if(depth>MAX_FILTER_DEPTH)throw new Error('FILTER_TOO_DEEP');
  if('field' in n){
   if(++count>MAX_FILTER_CONDITIONS-1)throw new Error('TOO_MANY_FILTERS');
   if(n.field==='farmId'||typeof n.value==='object'&&!Array.isArray(n.value)&&n.value?.type==='field'&&n.value.field==='farmId')throw new Error('FARM_SCOPE_IS_SERVER_MANAGED');
   const scalar=(v:Primitive):any=>typeof v==='boolean'?{type:'boolean',value:v}:typeof v==='number'?{type:'number',value:v}:{type:fieldType(n.field)==='date'?'date':'string',value:v};
   let value:FilterValue|undefined;
   if(Array.isArray(n.value)){
    if(n.operator==='between'){if(n.value.length!==2)throw new Error('RANGE_NEEDS_TWO_VALUES');value={type:'range',lower:scalar(n.value[0]),upper:scalar(n.value[1])};}
    else value={type:'list',values:n.value.map(scalar)};
   }else value=typeof n.value==='object'||n.value===undefined?n.value:scalar(n.value);
   return {field:n.field,operator:n.operator,value,id:randomUUID(),kind:'condition',negated:n.negated??false};
  }
  return {id:randomUUID(),kind:'group',negated:n.negated??false,combinator:n.combinator,children:n.children.map(x=>node(x,depth+1))};
 }
 const patch:ReportViewPatch={};
 if(input.filters){const selected=node(input.filters,2) as FilterGroup;patch.filters={id:randomUUID(),kind:'group',combinator:'and',negated:false,children:[{id:randomUUID(),kind:'condition',field:'farmId',operator:'eq',negated:false,value:{type:'string',value:farmId}},selected]};}
 if(input.columns)patch.columns=input.columns;
 if(input.sort)patch.sort=input.sort.map(r=>({...r,id:randomUUID()}));
 if(input.groupBy)patch.groupBy=input.groupBy.map(r=>({...r,id:randomUUID(),hideEmpty:r.hideEmpty??false})) as ReportViewPatch['groupBy'];
 return patch;
}
