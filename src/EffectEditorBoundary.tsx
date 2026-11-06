import React from 'react';
type Props={children:React.ReactNode;campaign:string};
type State={failed:boolean;message:string};
export default class EffectEditorBoundary extends React.Component<Props,State>{
  state:State={failed:false,message:''};
  static getDerivedStateFromError(error:unknown):State{
    return {failed:true,message:error instanceof Error?error.message:'Unexpected editor error'};
  }
  componentDidCatch(error:unknown,info:React.ErrorInfo){
    console.error('GM Effect Editor failed to render',error,info.componentStack);
  }
  componentDidUpdate(previous:Props){
    if(previous.campaign!==this.props.campaign&&this.state.failed){
      this.setState({failed:false,message:''});
    }
  }
  render(){
    if(this.state.failed)return <section className="nx-effect-panel" role="alert">
      <h3>Equipment Effects (GM) unavailable</h3>
      <p>The GM effect editor encountered an error, but your campaign and character inventory remain accessible.</p>
      <p className="nx-effect-error">{this.state.message}</p>
      <button type="button" onClick={()=>this.setState({failed:false,message:''})}>Retry editor</button>
    </section>;
    return this.props.children;
  }
}
