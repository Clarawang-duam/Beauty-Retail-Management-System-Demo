// 解锁项目地图：四等级并列，心形二元（解锁=红色发光 / 未解锁=灰色+待解锁）
import { evaluateProjectMap, PROJECT_MAP_LEVELS } from '../../../utils/projectMap'

function Heart({ unlocked }) {
  return (
    <svg
      width="30" height="30" viewBox="0 0 24 24"
      fill={unlocked ? '#f43f5e' : '#d1d5db'}
      style={unlocked ? { filter: 'drop-shadow(0 0 5px rgba(244,63,94,0.75))' } : undefined}
      aria-hidden="true"
    >
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  )
}

export default function ProjectMap({ memberProjects, projects, levels: levelsConfig }) {
  const config = Array.isArray(levelsConfig) && levelsConfig.length > 0 ? levelsConfig : PROJECT_MAP_LEVELS
  const levels = evaluateProjectMap(memberProjects, projects, config)
  return (
    <div>
      <div className="text-sm font-semibold text-gray-700 mb-2">解锁项目地图</div>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {levels.map((lv) => (
          <div key={lv.id} className="flex flex-col items-center gap-1 w-14">
            <Heart unlocked={lv.unlocked} />
            <span className={`text-xs text-center leading-tight ${lv.unlocked ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
              {lv.name}
            </span>
            {!lv.unlocked && <span className="text-[10px] text-gray-300 leading-none">待解锁</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
