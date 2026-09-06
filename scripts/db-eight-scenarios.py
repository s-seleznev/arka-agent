"""Add bounded synthetic lifecycle cases; retain the existing 150 adult cows."""
import importlib.util,json,uuid
from pathlib import Path
from datetime import date,datetime,time,timedelta,timezone
spec=importlib.util.spec_from_file_location('l150',Path(__file__).with_name('db-generate-l150.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
farm='2911f095-dd8c-5878-a8f3-2e027513ad6a';asof=date(2026,9,5);now=datetime.combine(asof,time(12),timezone.utc)
g=m.L150(809,farm,asof,[{}]*150);g.lines=['BEGIN;',"SET LOCAL statement_timeout='180s';", "DO $$ BEGIN IF EXISTS(SELECT 1 FROM animal_event WHERE farm_id='"+farm+"' AND source_record_id LIKE 'l150-case-%') THEN RAISE EXCEPTION 'Scenario fixture already applied'; END IF; END $$;"]
u=lambda x:str(uuid.uuid5(m.NAMESPACE,'case:'+x))
q=m.sql;r=m.raw
# Events use a stable namespace; all records are marked simulation.
def ev(a,k,c,days,t,d):return g.event(a,'case-'+k,c,now-timedelta(days=days),t,d)
def note(a,k,days,txt):ev(a,k,'NOTE_CHANGED',days,'event_note',{'note_id':u(k),'action':'ADDED','category':'DEMO','note_text':txt,'previous_note_event_id':None})
def group(a,k,code):ev(a,k,'GROUP_CHANGED',0,'event_group_change',{'previous_group_id':None,'new_group_id':r("SELECT id FROM farm_group WHERE farm_id='"+farm+"' AND code='"+code+"' LIMIT 1"),'reason':'Демонстрационная группа'})
for key in ['Телята · Бычки','Тёлки · 12–14 мес','Тёлки · 15+ мес','Архив · Выбытие']:
 g.add(f"INSERT INTO farm_group(id,farm_id,code,name,group_type,valid_from) VALUES({q(u(key))},{q(farm)},{q(key)},{q(key)},'AGE','2020-01-01') ON CONFLICT DO NOTHING")
for i in range(20):
 a=u('animal'+str(i));is_bull=i<5;is_exit=i>=15
 age=[25,19,10,7,3][i] if is_bull else (900+i*30 if is_exit else (366+(i-5)*23))
 birth=asof-timedelta(days=age);num=('B' if is_bull else 'X' if is_exit else 'H')+f'-{i+1:04}'
 g.add(f"INSERT INTO animal(id,farm_id,name,sex,birth_date,origin) VALUES({q(a)},{q(farm)},{q('Бычок '+num if is_bull else 'Корова '+num if is_exit else 'Тёлка '+num)},{q('MALE' if is_bull else 'FEMALE')},{q(birth)},'BORN_ON_FARM')")
 ev(a,num+'birth','BORN',age,'event_birth',{'birth_weight_kg':39,'birth_order':1,'viability':'ALIVE'})
 ev(a,num+'number','IDENTIFIER_CHANGED',age,'event_identifier_change',{'identifier_type':'INVENTORY_NUMBER','identifier_value':num,'action':'ASSIGNED','is_primary':True,'related_assignment_event_id':None})
 if is_exit:
  dim=[12,31,44,55,65][i-15];ago=10+i-15
  ev(a,num+'calving','CALVED',dim+ago,'event_calving',{'difficulty':1,'offspring_count':1,'live_offspring_count':1,'complications':None})
  reasons=['Болезни конечностей','Болезни вымени','Низкая продуктивность','Травма','Низкая продуктивность'];note(a,num+'note',ago+1,['Хромота, без улучшения','Мастит, без улучшения','Решение по продуктивности','Травма конечности','Контрольная запись: выбытие после 60 ДДЛ'][i-15])
  ev(a,num+'exit','EXITED',ago,'event_exit',{'exit_type':'CULLED','reason':reasons[i-15],'counterparty':None,'amount':None})
 else:
  weight=([58,52,46,44,41][i] if is_bull else 338+(i-5)*8)
  for n,d in enumerate([min(7,age-1),0]):
   ev(a,num+'weight'+str(n),'MEASURED',d,'event_measurement',{'measurement_code':'WEIGHT','value_numeric':round(weight-d*0.8,1),'unit_code':'KG','method':'SCALE','device_ref':None})
  group(a,num+'group','Телята · Бычки' if is_bull else 'Тёлки · 12–14 мес' if age<457 else 'Тёлки · 15+ мес')
  if not is_bull and i>=8:
   aid=ev(a,num+'ai','INSEMINATED',20 if i<11 else 40,'event_insemination',{'bull_ref':'Байкал 208','bull_registration_number':'208','semen_batch':'DEMO-8','dose':1,'method':'AI','technician_ref':'Сидорова','scheme_code':None})
   if i>=11:ev(a,num+'uzi','PREGNANCY_CHECKED',5,'event_pregnancy_check',{'insemination_event_id':aid,'method':'ULTRASOUND','result':'PREGNANT','gestation_days':35})
  status='HEIFER' if is_bull or i<8 else 'INSEMINATED' if i<11 else 'PREGNANT'
  ev(a,num+'status','STATUS_CHANGED',0,'event_status_change',{'previous_status_id':None,'new_status_id':r("SELECT id FROM animal_status_type WHERE farm_id IS NULL AND code='"+status+"'"),'reason':'Демо'})
existing=json.loads(Path('/tmp/scenario-existing.json').read_text())
fresh=[x for x in existing if x['status_code']=='FRESH' and x['days_in_milk']<=14]
for i,x in enumerate(fresh):
 ev(x['animal_id'],'freshcheck'+str(i),'HEALTH_OBSERVED',1,'event_health_observation',{'procedure_id':None,'observation_code':'FRESH_COW_CHECK','body_location':None,'result':'Осмотр выполнен','severity':None})
 note(x['animal_id'],'freshnote'+str(i),1,'Аппетит в норме' if i%2==0 else 'Повторный осмотр по плану')
# Correct selected synthetic AI histories with superseding events, not destructive updates.
candidates=[x for x in existing if x['status_code']=='PREGNANT' and x['days_in_milk']>=275][:4]
for i,x in enumerate(candidates):
 a=x['animal_id'];aid=ev(a,'dry-ai'+str(i),'INSEMINATED',218+i,'event_insemination',{'bull_ref':'Атлант 1123','bull_registration_number':'1123','semen_batch':'DEMO-8','dose':1,'method':'AI','technician_ref':'Петров','scheme_code':None})
 # Add supersedes directly into the just-emitted parent INSERT.
 old=r("SELECT e.id FROM animal_event e JOIN event_insemination d ON d.event_id=e.id WHERE e.animal_id='"+a+"' AND e.farm_id='"+farm+"' ORDER BY e.occurred_at DESC LIMIT 1")
 parent=g.lines[-2];parent=parent.replace('related_event_id,supersedes_event_id','related_event_id,supersedes_event_id')
 # Locate explicit NULL slots following actor_ref.
 parent=parent.replace("'db-generate-l150.py',NULL,NULL,NULL", "'db-generate-l150.py',NULL,("+old[5:-1]+"),NULL")
 g.lines[-2]=parent
 ev(a,'dry-uzi'+str(i),'PREGNANCY_CHECKED',183+i,'event_pregnancy_check',{'insemination_event_id':aid,'method':'ULTRASOUND','result':'PREGNANT','gestation_days':35})
 old_check="SELECT e.id FROM animal_event e JOIN event_pregnancy_check d ON d.event_id=e.id WHERE e.animal_id='"+a+"' AND e.farm_id='"+farm+"' ORDER BY e.occurred_at DESC LIMIT 1"
 g.lines[-2]=g.lines[-2].replace("'db-generate-l150.py',NULL,NULL,NULL", "'db-generate-l150.py',NULL,("+old_check+"),NULL")
# Recorded protocol plans: demonstration schedules, no dosing advice.
work=fresh[:2]+[x for x in existing if x['status_code']=='READY_FOR_INSEMINATION'][:3]+[x for x in existing if x['status_code']=='DRY'][:2]
for i,x in enumerate(work):
 key='work'+str(i);cat='TREATMENT' if i<2 else 'REPRODUCTION' if i<5 else 'PREVENTION';name='Контроль новотельных' if i<2 else 'Овсинх — контроль этапов' if i<5 else 'Вакцинация — контроль этапов';pid=u('protocol'+cat);offsets=[0,24,48,72,96] if i<2 else [0,168,216] if i<5 else [0,336]
 g.add(f"INSERT INTO protocol_definition(id,farm_id,code,name,category,version,valid_from) VALUES({q(pid)},{q(farm)},{q('DEMO_'+cat)},{q(name)},{q(cat)},1,'2020-01-01') ON CONFLICT DO NOTHING")
 for j,h in enumerate(offsets):g.add(f"INSERT INTO protocol_step_definition(id,protocol_id,step_code,position,offset_hours,action_code) VALUES({q(u(cat+str(j)))},{q(pid)},{q('STEP'+str(j))},{j+1},{h},'OBSERVATION') ON CONFLICT DO NOTHING")
 ago=1 if i<2 else 6 if i<5 else 2
 aid=ev(x['animal_id'],key+'assign','PROTOCOL_ASSIGNED',ago,'event_protocol_assignment',{'protocol_id':pid,'purpose':name,'planned_start_at':now-timedelta(days=ago)})
 ev(x['animal_id'],key+'step','PROTOCOL_STEP_COMPLETED',ago,'event_protocol_step',{'assignment_event_id':aid,'step_definition_id':u(cat+'0'),'planned_at':now-timedelta(days=ago),'completed_at':now-timedelta(days=ago),'result':'Выполнено'})
g.add('SELECT refresh_animal_state_query()');g.add('COMMIT')
Path('/tmp/eight-scenarios.sql').write_text('\n'.join(g.lines)+'\n')
