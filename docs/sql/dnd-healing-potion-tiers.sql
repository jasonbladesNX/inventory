-- D&D 5e healing consumables; all dice and bonuses are catalog data.
-- Campaign scope avoids adding D&D-specific items to other rulesets.
-- Idempotent: never overwrite GM customizations or previously-added catalog items.
insert into public.item_definitions
 (campaign_id,code,name,category,description,default_properties)
select c.id,v.code,v.name,'consumable',
       'Restores '||v.dice_count||'d4 + '||v.bonus||' hit points, up to your maximum, when consumed.',
       jsonb_build_object(
         'consumable',true,'stackable',true,'weight',0.5,'rarity',v.rarity,
         'use_effect',jsonb_build_object(
           'type','heal_hp','dice_count',v.dice_count,'dice_sides',4,'bonus',v.bonus
         )
       )
from public.campaigns c
join public.ruleset_versions rv on rv.id=c.ruleset_version_id
join public.game_systems gs on gs.id=rv.system_id
cross join (values
  ('nexus_potion_of_greater_healing','Potion of Greater Healing','uncommon',4,4),
  ('nexus_potion_of_superior_healing','Potion of Superior Healing','rare',8,8),
  ('nexus_potion_of_supreme_healing','Potion of Supreme Healing','very rare',10,20)
) v(code,name,rarity,dice_count,bonus)
where gs.code='dnd5e'
  and not exists (
    select 1 from public.item_definitions d
    where d.campaign_id=c.id and d.code=v.code
  );
