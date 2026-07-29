export type BackendState = 'stopped' | 'starting' | 'healthy' | 'error' | 'stopping';

export function backendStateLabel(state: BackendState): string {
  switch (state) {
    case 'starting': return '启动中';
    case 'healthy': return '正常';
    case 'error': return '异常';
    case 'stopping': return '停止中';
    case 'stopped': return '已停止';
  }
}
