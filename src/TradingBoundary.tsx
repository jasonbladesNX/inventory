import React from 'react';
type Props={children:React.ReactNode;character:string};
type State={failed:boolean;message:string};
export default class TradingBoundary extends React.Component<Props,State>{
 state:State={failed:false,message:''};
 static getDerivedStateFromError(error:unknown):State{
  return {failed:true,message:error instanceof Error?error.message:'Unexpected trading interface error'};
 }
 componentDidCatch(error:unknown,info:React.ErrorInfo){
  console.error('Player Trading failed to render',error,info.componentStack);
 }
 componentDidUpdate(previous:Props){
  if(previous.character!==this.props.character&&this.state.failed)this.setState({failed:false,message:''});
 }
 render(){
  if(this.state.failed)return <section className="mv-panel" role="alert">
   <h3>Player Trading temporarily unavailable</h3>
   <p>The trading interface encountered an error. Your character inventory is still available above.</p>
   <p>{this.state.message}</p>
   <button type="button" onClick={()=>this.setState({failed:false,message:''})}>Retry Trading</button>
  </section>;
  return this.props.children;
 }
}
