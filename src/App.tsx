// App.tsx — placeholder frame so the scaffold renders; the frontend agent
// replaces this with the real App (frame scale, IconBar, screens).
import { COLOR, FRAME, TYPE } from './tokens';

export function App() {
  return (
    <div
      className="phone"
      style={{
        width: FRAME.w,
        height: FRAME.h,
        display: 'grid',
        placeItems: 'center',
        color: COLOR.muted,
        fontSize: TYPE.label.size,
        lineHeight: `${TYPE.label.lineHeight}px`,
      }}
    >
      stacks
    </div>
  );
}
