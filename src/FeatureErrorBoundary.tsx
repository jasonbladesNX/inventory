import React from 'react';
type State={failed:boolean;message:string};
export default class FeatureErrorBoundary extends React.Component<{title:string;children:React.ReactNode},State>{
 state:State={failed:false,message:''};
 static getDerivedStateFromError(error:unknown):State{return{failed:true,message:error instanceof Error?error.message:'Unexpected interface error'}}
 componentDidCatch(error:unknown,info:React.ErrorInfo){console.error('Nexus feature failed:',this.props.title,error,info.componentStack)}
 render(){if(!this.state.failed)return this.props.children;
  return <section className="mv-panel" role="alert">
   <h3>{this.props.title} temporarily unavailable</h3>
   <p>The rest of your character inventory remains accessible.</p>
   <p>{this.state.message}</p>
   <button type="button" onClick={()=>this.setState({failed:false,message:''})}>Retry {this.props.title}</button>
  </section>
 }
}
